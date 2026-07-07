import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { subscriptionPaySchema } from "@/lib/validators-domain";
import { canAccessRecord, canModifyRecord } from "@/lib/permissions";
import { sendPaymentConfirmationEmail } from "@/lib/notifications-payment";
import { advanceCycle } from "@/lib/cascades";
import { subscriptionDescription } from "@/lib/bill-schedule";
import {
  ReminderKind,
  ReminderStatus,
  type Subscription,
  type SubscriptionSchedule,
  SubscriptionStatus,
  TransactionKind,
  TransactionType,
} from "@/generated/prisma/client";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[subscriptions/[id]/pay]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

/**
 * One-click pay. Closes the soonest UPCOMING schedule row (or a
 * specific one if `scheduleId` is given), creates a Transaction
 * (kind=SUBSCRIPTION) linked to the subscription + schedule, confirms
 * the reminder, advances nextBillingDate, and seeds the next UPCOMING
 * schedule + reminder so the cycle continues.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireWorkspace("subscriptions", "write");
    const session = await auth();
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const parsed = subscriptionPaySchema.safeParse(body ?? {});
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const d = parsed.data;

    const sub = (await (
      prisma.subscription.findUnique as unknown as (a: {
        where: { id: string };
      }) => Promise<Subscription | null>
    )({ where: { id } }));
    if (!sub || sub.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!canModifyRecord(session, sub)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Resolve the schedule row: explicit if provided, else soonest UPCOMING.
    // Cast to dodge Prisma 7 deep-instantiation quirk on large schemas.
    const schedule = (d.scheduleId
      ? await (
          prisma.subscriptionSchedule.findUnique as unknown as (
            a: unknown,
          ) => Promise<SubscriptionSchedule | null>
        )({ where: { id: d.scheduleId } })
      : await (
          prisma.subscriptionSchedule.findFirst as unknown as (
            a: unknown,
          ) => Promise<SubscriptionSchedule | null>
        )({
          where: { subscriptionId: id, status: ReminderStatus.UPCOMING },
          orderBy: { dueDate: "asc" },
        }));
    if (!schedule || schedule.subscriptionId !== sub.id) {
      return NextResponse.json(
        { error: "No upcoming schedule found" },
        { status: 400 },
      );
    }
    if (schedule.status !== ReminderStatus.UPCOMING) {
      return NextResponse.json(
        { error: "Schedule already settled" },
        { status: 400 },
      );
    }

    // Explicit source overrides the subscription's default. Without this,
    // picking a card while the subscription defaults to an account would
    // leave both set and fail the XOR.
    const explicitSource = d.accountId !== undefined || d.cardId !== undefined;
    const accountId = explicitSource ? (d.accountId ?? null) : sub.accountId;
    const cardId = explicitSource ? (d.cardId ?? null) : sub.cardId;
    if (!accountId && !cardId) {
      return NextResponse.json(
        { error: "Pick a source account or card" },
        { status: 400 },
      );
    }
    if (accountId && cardId) {
      return NextResponse.json(
        { error: "Pick exactly one source" },
        { status: 400 },
      );
    }

    const amount = d.amount ?? Number(schedule.amount);
    const paidOn = d.paidOn ? new Date(d.paidOn) : new Date();
    if (Number.isNaN(paidOn.getTime())) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }

    // For card payments, route through the card's companion account so
    // balance math matches existing conventions (see transactions POST).
    let resolvedAccountId: string | null = accountId;
    if (cardId) {
      const card = await prisma.card.findUnique({
        where: { id: cardId },
        select: {
          workspaceId: true,
          accountId: true,
          ownerUserId: true,
          sharedWithUserIds: true,
        },
      });
      if (!card || card.workspaceId !== ctx.workspaceId) {
        return NextResponse.json({ error: "Card not found" }, { status: 404 });
      }
      if (!canAccessRecord(session, card)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      resolvedAccountId = card.accountId ?? resolvedAccountId;
    } else if (accountId) {
      const acc = await prisma.account.findUnique({
        where: { id: accountId },
        select: {
          workspaceId: true,
          ownerUserId: true,
          sharedWithUserIds: true,
        },
      });
      if (!acc || acc.workspaceId !== ctx.workspaceId) {
        return NextResponse.json({ error: "Account not found" }, { status: 404 });
      }
      if (!canAccessRecord(session, acc)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const txn = await tx.transaction.create({
        data: {
          workspaceId: ctx.workspaceId,
          type: TransactionType.EXPENSE,
          kind: TransactionKind.SUBSCRIPTION,
          amount,
          description:
            d.notes?.trim() ||
            subscriptionDescription(sub.name, schedule.dueDate, sub.cycle),
          date: paidOn,
          accountId: resolvedAccountId,
          cardId,
          categoryId: sub.categoryId,
          subscriptionId: sub.id,
          subscriptionScheduleId: schedule.id,
          userId: ctx.userId,
          createdByUserId: ctx.userId,
        },
      });
      await tx.subscriptionSchedule.update({
        where: { id: schedule.id },
        data: { status: ReminderStatus.CONFIRMED },
      });
      await tx.investmentReminder.updateMany({
        where: { subscriptionScheduleId: schedule.id },
        data: {
          status: ReminderStatus.CONFIRMED,
          confirmedTransactionId: txn.id,
        },
      });

      // Roll forward only when this pay represents the current cycle
      // (i.e., schedule.dueDate matches sub.nextBillingDate). A pay of a
      // past-skipped cycle shouldn't advance the master schedule.
      if (schedule.dueDate.getTime() === sub.nextBillingDate.getTime()) {
        const nextDue = advanceCycle(sub.nextBillingDate, sub.cycle);
        // Stop scheduling when we've passed endsOn.
        const beyondEnd = sub.endsOn && nextDue > sub.endsOn;
        const nextStatus =
          sub.status === SubscriptionStatus.ACTIVE && !beyondEnd
            ? SubscriptionStatus.ACTIVE
            : sub.status;
        await tx.subscription.update({
          where: { id: sub.id },
          data: {
            nextBillingDate: nextDue,
            status: nextStatus,
          },
        });
        if (nextStatus === SubscriptionStatus.ACTIVE) {
          const newSchedule = await tx.subscriptionSchedule.create({
            data: {
              subscriptionId: sub.id,
              dueDate: nextDue,
              amount: Number(sub.amount),
              status: ReminderStatus.UPCOMING,
            },
          });
          await tx.investmentReminder.create({
            data: {
              workspaceId: ctx.workspaceId,
              subscriptionId: sub.id,
              subscriptionScheduleId: newSchedule.id,
              kind: ReminderKind.SUBSCRIPTION_RENEWAL,
              dueDate: nextDue,
              amount: Number(sub.amount),
            },
          });
        }
      }

      return { transactionId: txn.id };
    });

    // Best-effort email — never block the response on dispatch.
    void sendPaymentConfirmationEmail({
      workspaceId: ctx.workspaceId,
      recipientUserIds: [ctx.userId],
      kind: "SUBSCRIPTION",
      autopayed: false,
      amount,
      label: sub.name,
      sourceLabel: cardId ? "Card" : "Account",
      cycleLabel: sub.cycle.toLowerCase().replace("_", "-"),
      nextDate: null,
      link: `/subscriptions/${sub.id}`,
    }).catch((e) => console.warn("[subscription-pay] email failed", e));

    return NextResponse.json(result);
  } catch (e) {
    return err(e);
  }
}
