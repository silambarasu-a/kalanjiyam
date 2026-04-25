import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { canAccessRecord } from "@/lib/permissions";
import { leasePaymentConfirmSchema } from "@/lib/validators-domain";
import {
  ReminderStatus,
  TransactionType,
  TransactionKind,
} from "@/generated/prisma/client";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[lease-confirm]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

/**
 * Confirm a scheduled lease payment. Creates a LEASE_INCOME or EXPENSE
 * transaction tied to the lease+schedule and marks the row CONFIRMED.
 *
 * LEASED_OUT lease  → INCOME on the chosen account.
 * LEASED_IN lease   → EXPENSE on the chosen account.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; scheduleId: string }> }
) {
  try {
    const ctx = await requireWorkspace("leases", "write");
    const session = await auth();
    const { id, scheduleId } = await context.params;
    const lease = await prisma.lease.findUnique({ where: { id } });
    if (!lease || lease.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Lease not found" }, { status: 404 });
    }
    const schedule = await prisma.leasePaymentSchedule.findUnique({ where: { id: scheduleId } });
    if (!schedule || schedule.leaseId !== id) {
      return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
    }
    if (schedule.status === "CONFIRMED") {
      return NextResponse.json({ error: "Already confirmed" }, { status: 400 });
    }

    const body = await request.json();
    const parsed = leasePaymentConfirmSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    let resolvedAccountId: string | null = parsed.data.accountId ?? null;
    if (parsed.data.cardId) {
      const card = await prisma.card.findUnique({ where: { id: parsed.data.cardId } });
      if (!card || card.workspaceId !== ctx.workspaceId) {
        return NextResponse.json({ error: "Card not found" }, { status: 404 });
      }
      if (!canAccessRecord(session, card)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      resolvedAccountId = card.accountId ?? resolvedAccountId;
    }
    if (!resolvedAccountId) {
      return NextResponse.json({ error: "Pick an account or card" }, { status: 400 });
    }

    const txnAmount = parsed.data.amount ?? Number(schedule.amount);
    const txnDate = parsed.data.date ? new Date(parsed.data.date) : new Date();
    const txnType =
      lease.direction === "LEASED_OUT"
        ? TransactionType.INCOME
        : TransactionType.EXPENSE;
    const txnKind =
      lease.direction === "LEASED_OUT" ? TransactionKind.LEASE_INCOME : null;

    await prisma.$transaction(async (tx) => {
      const txn = await tx.transaction.create({
        data: {
          workspaceId: ctx.workspaceId,
          type: txnType,
          kind: txnKind ?? undefined,
          amount: txnAmount,
          description: `Lease ${lease.direction === "LEASED_OUT" ? "income" : "payment"}${parsed.data.notes ? ` · ${parsed.data.notes}` : ""}`,
          date: txnDate,
          accountId: resolvedAccountId,
          cardId: parsed.data.cardId ?? null,
          leaseId: id,
          leaseScheduleId: scheduleId,
          userId: ctx.userId,
          createdByUserId: ctx.userId,
        },
      });
      await tx.leasePaymentSchedule.update({
        where: { id: scheduleId },
        data: { status: ReminderStatus.CONFIRMED },
      });
      return txn;
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}
