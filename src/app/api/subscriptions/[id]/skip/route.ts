import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { subscriptionSkipSchema } from "@/lib/validators-domain";
import { canModifyRecord } from "@/lib/permissions";
import { advanceCycle } from "@/lib/cascades";
import {
  ReminderKind,
  ReminderStatus,
  SubscriptionStatus,
} from "@/generated/prisma/client";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[subscriptions/[id]/skip]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

/**
 * Mark the current UPCOMING cycle as SKIPPED, then advance the master
 * nextBillingDate by one cycle and seed the next UPCOMING row +
 * reminder. Useful for "skip this month" without creating a payment.
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
    const parsed = subscriptionSkipSchema.safeParse(body ?? {});
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const d = parsed.data;

    const sub = await prisma.subscription.findUnique({ where: { id } });
    if (!sub || sub.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!canModifyRecord(session, sub)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const schedule = d.scheduleId
      ? await prisma.subscriptionSchedule.findUnique({
          where: { id: d.scheduleId },
        })
      : await prisma.subscriptionSchedule.findFirst({
          where: { subscriptionId: id, status: ReminderStatus.UPCOMING },
          orderBy: { dueDate: "asc" },
        });
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

    await prisma.$transaction(async (tx) => {
      await tx.subscriptionSchedule.update({
        where: { id: schedule.id },
        data: {
          status: ReminderStatus.SKIPPED,
          skippedReason: d.reason ?? null,
        },
      });
      await tx.investmentReminder.updateMany({
        where: { subscriptionScheduleId: schedule.id },
        data: { status: ReminderStatus.SKIPPED, skippedReason: d.reason ?? null },
      });

      if (schedule.dueDate.getTime() === sub.nextBillingDate.getTime()) {
        const nextDue = advanceCycle(sub.nextBillingDate, sub.cycle);
        const beyondEnd = sub.endsOn && nextDue > sub.endsOn;
        const nextStatus =
          sub.status === SubscriptionStatus.ACTIVE && !beyondEnd
            ? SubscriptionStatus.ACTIVE
            : sub.status;
        await tx.subscription.update({
          where: { id: sub.id },
          data: { nextBillingDate: nextDue, status: nextStatus },
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
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}
