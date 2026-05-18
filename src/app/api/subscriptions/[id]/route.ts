import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { subscriptionUpdateSchema } from "@/lib/validators-domain";
import { canModifyRecord } from "@/lib/permissions";
import {
  ReminderKind,
  ReminderStatus,
  SubscriptionCycle,
  SubscriptionStatus,
} from "@/generated/prisma/client";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[subscriptions/[id]]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

function parseDate(value: string): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime()))
    throw new WorkspaceAccessError(400, "Invalid date");
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireWorkspace("subscriptions", "read");
    const { id } = await context.params;
    const sub = await prisma.subscription.findUnique({
      where: { id },
      include: {
        account: { select: { id: true, name: true, kind: true } },
        card: { select: { id: true, name: true, network: true } },
        category: { select: { id: true, name: true } },
        owner: { select: { id: true, name: true } },
        schedules: {
          orderBy: { dueDate: "desc" },
          take: 60,
          include: {
            confirmedTxn: { select: { id: true, amount: true, date: true } },
          },
        },
      },
    });
    if (!sub || sub.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({
      subscription: {
        id: sub.id,
        name: sub.name,
        amount: Number(sub.amount),
        cycle: sub.cycle,
        status: sub.status,
        nextBillingDate: sub.nextBillingDate.toISOString(),
        startedOn: sub.startedOn.toISOString(),
        endsOn: sub.endsOn?.toISOString() ?? null,
        autoPay: sub.autoPay,
        logoUrl: sub.logoUrl,
        notes: sub.notes,
        account: sub.account,
        card: sub.card,
        category: sub.category,
        owner: sub.owner,
        schedules: sub.schedules.map((s) => ({
          id: s.id,
          dueDate: s.dueDate.toISOString(),
          amount: Number(s.amount),
          status: s.status,
          skippedReason: s.skippedReason,
          confirmedTxn: s.confirmedTxn
            ? {
                id: s.confirmedTxn.id,
                amount: Number(s.confirmedTxn.amount),
                date: s.confirmedTxn.date.toISOString(),
              }
            : null,
        })),
      },
    });
  } catch (e) {
    return err(e);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireWorkspace("subscriptions", "write");
    const session = await auth();
    const { id } = await context.params;
    const existing = await prisma.subscription.findUnique({ where: { id } });
    if (!existing || existing.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!canModifyRecord(session, existing)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = await request.json();
    const parsed = subscriptionUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const d = parsed.data;
    const nextBilling = d.nextBillingDate ? parseDate(d.nextBillingDate) : null;
    const startedOn = d.startedOn ? parseDate(d.startedOn) : null;
    const endsOn =
      d.endsOn === undefined ? undefined : d.endsOn ? parseDate(d.endsOn) : null;

    const cycleChanged = d.cycle && d.cycle !== existing.cycle;
    const amountChanged = d.amount !== undefined && Number(d.amount) !== Number(existing.amount);
    const nextChanged =
      nextBilling && nextBilling.getTime() !== existing.nextBillingDate.getTime();

    await prisma.$transaction(async (tx) => {
      await tx.subscription.update({
        where: { id },
        data: {
          name: d.name ?? undefined,
          amount: d.amount ?? undefined,
          cycle: (d.cycle as SubscriptionCycle | undefined) ?? undefined,
          nextBillingDate: nextBilling ?? undefined,
          startedOn: startedOn ?? undefined,
          endsOn,
          accountId: d.accountId === undefined ? undefined : d.accountId,
          cardId: d.cardId === undefined ? undefined : d.cardId,
          autoPay: d.autoPay ?? undefined,
          categoryId: d.categoryId === undefined ? undefined : d.categoryId,
          logoUrl: d.logoUrl === undefined ? undefined : d.logoUrl,
          notes: d.notes === undefined ? undefined : d.notes,
          status: (d.status as SubscriptionStatus | undefined) ?? undefined,
        },
      });

      // If cycle / amount / nextBillingDate changed, regenerate the
      // single UPCOMING schedule row + reminder. CONFIRMED rows are
      // preserved (they represent actual paid history).
      if (cycleChanged || amountChanged || nextChanged) {
        const upcoming = await tx.subscriptionSchedule.findMany({
          where: { subscriptionId: id, status: ReminderStatus.UPCOMING },
          select: { id: true },
        });
        if (upcoming.length > 0) {
          const ids = upcoming.map((u) => u.id);
          await tx.investmentReminder.deleteMany({
            where: { subscriptionScheduleId: { in: ids } },
          });
          await tx.subscriptionSchedule.deleteMany({
            where: { id: { in: ids } },
          });
        }
        const due = nextBilling ?? existing.nextBillingDate;
        const amount = d.amount ?? Number(existing.amount);
        const status = (d.status as SubscriptionStatus | undefined) ?? existing.status;
        if (status === SubscriptionStatus.ACTIVE) {
          const newSchedule = await tx.subscriptionSchedule.create({
            data: {
              subscriptionId: id,
              dueDate: due,
              amount,
              status: ReminderStatus.UPCOMING,
            },
          });
          await tx.investmentReminder.create({
            data: {
              workspaceId: ctx.workspaceId,
              subscriptionId: id,
              subscriptionScheduleId: newSchedule.id,
              kind: ReminderKind.SUBSCRIPTION_RENEWAL,
              dueDate: due,
              amount,
            },
          });
        }
      }
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}

/**
 * Soft-cancel (status=CANCELLED) by default. Pass `?hard=1` to attempt
 * a hard delete — only succeeds when no CONFIRMED schedule rows exist
 * (i.e., no paid history). Otherwise downgrade to soft-cancel.
 */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireWorkspace("subscriptions", "write");
    const session = await auth();
    const { id } = await context.params;
    const sub = await prisma.subscription.findUnique({ where: { id } });
    if (!sub || sub.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!canModifyRecord(session, sub)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const url = new URL(request.url);
    const hard = url.searchParams.get("hard") === "1";

    const confirmedCount = await prisma.subscriptionSchedule.count({
      where: { subscriptionId: id, status: ReminderStatus.CONFIRMED },
    });

    if (hard && confirmedCount === 0) {
      await prisma.$transaction(async (tx) => {
        await tx.investmentReminder.deleteMany({ where: { subscriptionId: id } });
        await tx.subscriptionSchedule.deleteMany({ where: { subscriptionId: id } });
        await tx.subscription.delete({ where: { id } });
      });
      return NextResponse.json({ ok: true, mode: "hard" });
    }

    await prisma.$transaction(async (tx) => {
      await tx.subscription.update({
        where: { id },
        data: { status: SubscriptionStatus.CANCELLED },
      });
      await tx.subscriptionSchedule.deleteMany({
        where: { subscriptionId: id, status: ReminderStatus.UPCOMING },
      });
      await tx.investmentReminder.deleteMany({
        where: { subscriptionId: id, status: ReminderStatus.UPCOMING },
      });
    });
    return NextResponse.json({ ok: true, mode: "soft" });
  } catch (e) {
    return err(e);
  }
}
