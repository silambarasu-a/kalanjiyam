import { type Prisma, ReminderStatus } from "@/generated/prisma/client";
import { advanceDate, type PremiumFrequency } from "@/lib/reminder-schedule";

/**
 * Cascade helpers for deleting / editing money-moving transactions.
 *
 * Every helper takes a Prisma TransactionClient (the `tx` you get inside
 * `prisma.$transaction(async (tx) => {...})`) so callers compose them
 * atomically with their own row mutations.
 *
 * Invariants enforced:
 *   - Subscription schedule rows roll back from CONFIRMED → UPCOMING.
 *   - Subscription.nextBillingDate only rolls back when the deleted
 *     payment is the most recent one (otherwise history is preserved).
 *   - UtilityProvider.advanceBalance is never allowed to go negative.
 *   - Reminders linked through the schedule/bill are reset to UPCOMING.
 */

function cycleToFrequency(cycle: string): PremiumFrequency {
  switch (cycle) {
    case "MONTHLY":
      return "MONTHLY";
    case "QUARTERLY":
      return "QUARTERLY";
    case "HALF_YEARLY":
      return "HALF_YEARLY";
    case "YEARLY":
      return "YEARLY";
    default:
      // WEEKLY (or anything else) falls back to MONTHLY for the
      // reminder-schedule helper; weekly rollover is handled inline by
      // callers that need it.
      return "MONTHLY";
  }
}

function advanceCycle(date: Date, cycle: string): Date {
  if (cycle === "WEEKLY") {
    const d = new Date(date);
    d.setUTCDate(d.getUTCDate() + 7);
    return d;
  }
  return advanceDate(date, cycleToFrequency(cycle));
}

function rollbackCycle(date: Date, cycle: string): Date {
  if (cycle === "WEEKLY") {
    const d = new Date(date);
    d.setUTCDate(d.getUTCDate() - 7);
    return d;
  }
  const months = (
    {
      MONTHLY: 1,
      QUARTERLY: 3,
      HALF_YEARLY: 6,
      YEARLY: 12,
    } as const
  )[cycle as "MONTHLY" | "QUARTERLY" | "HALF_YEARLY" | "YEARLY"];
  const d = new Date(date);
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() - (months ?? 1));
  if (d.getUTCDate() < day) d.setUTCDate(0);
  return d;
}

/**
 * Undo a Subscription pay (Transaction with kind=SUBSCRIPTION).
 * Re-opens the schedule row, resets the reminder, and rolls back
 * nextBillingDate ONLY if this txn was the most recent confirmed pay.
 *
 * Returns a short list of human-readable side effects for the cascade
 * preview UI.
 */
export async function revertSubscriptionPay(
  tx: Prisma.TransactionClient,
  txnId: string,
): Promise<string[]> {
  const notes: string[] = [];
  const txn = await tx.transaction.findUnique({
    where: { id: txnId },
    select: {
      id: true,
      subscriptionId: true,
      subscriptionScheduleId: true,
      workspaceId: true,
      amount: true,
    },
  });
  if (!txn?.subscriptionScheduleId) return notes;

  const schedule = await tx.subscriptionSchedule.findUnique({
    where: { id: txn.subscriptionScheduleId },
    select: { id: true, dueDate: true, subscriptionId: true },
  });
  if (!schedule) return notes;

  await tx.subscriptionSchedule.update({
    where: { id: schedule.id },
    data: { status: ReminderStatus.UPCOMING, skippedReason: null },
  });

  // Reset the per-schedule reminder back to UPCOMING and unlink the
  // confirming txn (the txn itself may already be queued for delete).
  await tx.investmentReminder.updateMany({
    where: {
      subscriptionScheduleId: schedule.id,
      confirmedTransactionId: txn.id,
    },
    data: {
      status: ReminderStatus.UPCOMING,
      confirmedTransactionId: null,
    },
  });

  if (!txn.subscriptionId) return notes;

  // Roll back nextBillingDate only if this was the most-recent pay.
  // `gte` + id-exclusion handles same-day pays correctly: if there's
  // another CONFIRMED schedule with the same dueDate as the one we're
  // reverting, treat IT as more recent and skip the rollback.
  const moreRecentConfirmed = await tx.subscriptionSchedule.findFirst({
    where: {
      subscriptionId: txn.subscriptionId,
      status: ReminderStatus.CONFIRMED,
      dueDate: { gte: schedule.dueDate },
      id: { not: schedule.id },
    },
    select: { id: true },
  });
  const sub = await tx.subscription.findUnique({
    where: { id: txn.subscriptionId },
    select: { id: true, cycle: true, nextBillingDate: true, name: true },
  });
  if (sub && !moreRecentConfirmed) {
    const rolled = rollbackCycle(sub.nextBillingDate, sub.cycle);
    await tx.subscription.update({
      where: { id: sub.id },
      data: { nextBillingDate: schedule.dueDate <= rolled ? schedule.dueDate : rolled },
    });
    notes.push(`Reopened ${sub.name} cycle for ${schedule.dueDate.toISOString().slice(0, 10)}`);
  } else if (sub) {
    notes.push(`Reopened ${sub.name} cycle for ${schedule.dueDate.toISOString().slice(0, 10)}`);
  }

  return notes;
}

/**
 * Undo a Utility Bill pay (Transaction with kind=UTILITY_BILL).
 * Refunds advanceApplied back to the provider's running balance, clears
 * paidAt + paidTransactionId on the bill, resets the reminder.
 */
export async function revertUtilityBillPay(
  tx: Prisma.TransactionClient,
  txnId: string,
): Promise<string[]> {
  const notes: string[] = [];
  const txn = await tx.transaction.findUnique({
    where: { id: txnId },
    select: { id: true, utilityBillId: true, utilityProviderId: true },
  });
  if (!txn?.utilityBillId) return notes;

  const bill = await tx.utilityBill.findUnique({
    where: { id: txn.utilityBillId },
    select: {
      id: true,
      providerId: true,
      advanceApplied: true,
      billAmount: true,
      dueDate: true,
      provider: { select: { providerName: true } },
    },
  });
  if (!bill) return notes;

  const advanceBack = Number(bill.advanceApplied);
  if (advanceBack > 0) {
    await tx.utilityProvider.update({
      where: { id: bill.providerId },
      data: { advanceBalance: { increment: bill.advanceApplied } },
    });
    notes.push(
      `Returned ₹${advanceBack.toLocaleString("en-IN")} to ${bill.provider.providerName} advance balance`,
    );
  }
  await tx.utilityBill.update({
    where: { id: bill.id },
    data: {
      paidAt: null,
      paidTransactionId: null,
      advanceApplied: 0,
    },
  });
  await tx.investmentReminder.updateMany({
    where: { utilityBillId: bill.id, confirmedTransactionId: txn.id },
    data: { status: ReminderStatus.UPCOMING, confirmedTransactionId: null },
  });
  notes.push(
    `Marked ${bill.provider.providerName} bill (${bill.dueDate.toISOString().slice(0, 10)}) as unpaid`,
  );
  return notes;
}

/**
 * Undo a Utility Advance deposit (Transaction with kind=UTILITY_ADVANCE).
 * Subtracts the amount from the provider's advance balance. Returns
 * `{ ok: false, reason }` if the balance would go negative — caller
 * should refuse the delete and surface the reason in the UI.
 */
export async function revertUtilityAdvance(
  tx: Prisma.TransactionClient,
  txnId: string,
): Promise<{ ok: true; notes: string[] } | { ok: false; reason: string }> {
  const txn = await tx.transaction.findUnique({
    where: { id: txnId },
    select: { id: true, amount: true, utilityProviderId: true },
  });
  if (!txn?.utilityProviderId)
    return { ok: true, notes: [] };

  const provider = await tx.utilityProvider.findUnique({
    where: { id: txn.utilityProviderId },
    select: { id: true, advanceBalance: true, providerName: true },
  });
  if (!provider) return { ok: true, notes: [] };

  const remaining = Number(provider.advanceBalance) - Number(txn.amount);
  if (remaining < -0.005) {
    const shortfall = Math.abs(remaining);
    return {
      ok: false,
      reason: `Cannot delete — ₹${shortfall.toLocaleString("en-IN")} of this advance has already been used to pay ${provider.providerName} bills. Delete those bill payments first.`,
    };
  }
  await tx.utilityProvider.update({
    where: { id: provider.id },
    data: { advanceBalance: { decrement: txn.amount } },
  });
  return {
    ok: true,
    notes: [
      `Reduced ${provider.providerName} advance balance by ₹${Number(txn.amount).toLocaleString("en-IN")}`,
    ],
  };
}

/**
 * Undo a broiler-contract Lift transaction. The lift POST creates an
 * INCOME Transaction (kind=CONTRACT_PAYOUT) plus a SALE LivestockEvent
 * and an EXIT WeighingLog — all three reference the same date. When
 * the user deletes the Transaction we have to:
 *
 *   1. Find the linked SALE LivestockEvent (via `transactionId`) and
 *      undo it: increment `currentCount` by `event.count`, then
 *      delete the event.
 *   2. Find and delete the EXIT WeighingLog created for the same lift
 *      (matched by batchId + phase=EXIT + same date).
 *   3. If the batch was closed by the lift (active=false + endDate
 *      matches), reopen it.
 *
 * Returns `{ ok, notes }` for the cascade-preview dialog.
 */
export async function revertContractLift(
  tx: Prisma.TransactionClient,
  txnId: string,
): Promise<{ ok: true; notes: string[] }> {
  const notes: string[] = [];

  const event = await tx.livestockEvent.findUnique({
    where: { transactionId: txnId },
    include: {
      batch: {
        select: {
          id: true,
          name: true,
          active: true,
          endDate: true,
          currentCount: true,
        },
      },
    },
  });
  if (!event) return { ok: true, notes };

  // 1 + 2. Restore head count + delete the SALE event.
  await tx.livestockBatch.update({
    where: { id: event.batchId },
    data: { currentCount: { increment: event.count } },
  });
  notes.push(
    `Restored ${event.count} head to ${event.batch.name}`,
  );
  await tx.livestockEvent.delete({ where: { id: event.id } });

  // 3. Find + delete the matching EXIT WeighingLog. Lift always
  // creates one on the same date as the event; if more than one EXIT
  // weighing exists for the date (manual + lift), we delete the most
  // recent (the lift weighing always sits at the top because the
  // event row was just created).
  const liftWeighing = await tx.weighingLog.findFirst({
    where: {
      batchId: event.batchId,
      phase: "EXIT",
      date: event.date,
    },
    orderBy: { createdAt: "desc" },
  });
  if (liftWeighing) {
    await tx.weighingLog.delete({ where: { id: liftWeighing.id } });
    notes.push("Removed the EXIT weighing");
  }

  // 4. Reopen the batch if the lift closed it. Heuristic: endDate
  // matches the event date (within the same UTC day) and active=false.
  if (
    !event.batch.active &&
    event.batch.endDate &&
    sameUtcDay(event.batch.endDate, event.date)
  ) {
    await tx.livestockBatch.update({
      where: { id: event.batchId },
      data: { active: true, endDate: null },
    });
    notes.push(`Reopened ${event.batch.name}`);
  }

  return { ok: true, notes };
}

function sameUtcDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

/** Same advance helper, exposed for non-cascade uses (e.g. forward pay). */
export { advanceCycle, rollbackCycle };
