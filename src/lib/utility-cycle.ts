import {
  type Prisma,
  ReminderKind,
  ReminderStatus,
  type UtilityBillCycle,
} from "@/generated/prisma/client";
import { advanceBillCycle, cycleMonths } from "@/lib/bill-schedule";

/**
 * Keeping a recurring provider's generator cursor in step with reality.
 *
 * A fixed `nextBillDate += cycle` grid is only correct when the utility
 * bills like clockwork. Electricity does not: a nominally bimonthly TNEB
 * connection can issue a bill after one month, or ten weeks. Left on its
 * own grid the cursor drifts permanently out of phase with the real
 * statements — minting placeholders on dates no bill exists for while
 * missing the ones that do arrive.
 *
 * The fix is to treat every REAL bill as the authoritative anchor: when
 * one is recorded, the cursor jumps to that bill's date plus one expected
 * cycle. Drift is corrected at every step instead of accumulating.
 */

/**
 * How far from the cursor an existing bill still counts as "the bill this
 * run was going to generate". Without a window the generator's
 * exact-date guard misses a real bill entered a few days off the expected
 * statement day and mints a duplicate placeholder beside it.
 */
export const BILL_MATCH_TOLERANCE_DAYS = 10;

type CursorProvider = {
  id: string;
  recurring: boolean;
  prepaid: boolean;
  billingCycle: UtilityBillCycle;
  cycleVaries: boolean;
};

/**
 * Whether a bill is the CURRENT one — the statement the provider is on
 * now — rather than history being back-filled.
 *
 * The test is one cycle wide: on a bimonthly connection a bill dated
 * within the last two months is the live one; anything older is the user
 * typing in past bills. Getting this wrong is expensive in both
 * directions — anchoring to a year-old entry would drag the cursor into
 * the past and have the generator mint a year of catch-up placeholders,
 * while refusing to anchor to an early-arriving bill would leave the
 * cadence permanently out of step.
 */
function isCurrentStatement(
  billDate: Date,
  cycle: UtilityBillCycle,
  now: Date,
): boolean {
  const oldest = new Date(now);
  oldest.setUTCHours(0, 0, 0, 0);
  oldest.setUTCMonth(oldest.getUTCMonth() - cycleMonths(cycle));
  return billDate >= oldest;
}

/**
 * Re-anchor a recurring provider's cursor onto a real bill: the next one
 * is expected one cycle after THIS statement, not one cycle after
 * whatever the grid last predicted.
 *
 * Also clears any outstanding "bill expected" prompt for a variable-
 * cadence provider — the bill it was asking for has now arrived.
 *
 * No-ops for non-recurring and prepaid providers (neither has a cursor)
 * and for back-dated history entries (see `isCurrentStatement`).
 */
export async function anchorCursorToBill(
  tx: Prisma.TransactionClient,
  provider: CursorProvider,
  billDate: Date,
): Promise<void> {
  if (!provider.recurring || provider.prepaid) return;
  if (!isCurrentStatement(billDate, provider.billingCycle, new Date())) return;

  await tx.utilityProvider.update({
    where: { id: provider.id },
    data: { nextBillDate: advanceBillCycle(billDate, provider.billingCycle) },
  });

  if (provider.cycleVaries) {
    await tx.investmentReminder.deleteMany({
      where: {
        utilityProviderId: provider.id,
        kind: ReminderKind.UTILITY_BILL_EXPECTED,
        status: ReminderStatus.UPCOMING,
      },
    });
  }
}

/**
 * Raise the "a bill is expected around now" prompt for a variable-cadence
 * provider — at most one open at a time.
 *
 * Deliberately does NOT re-point an existing open reminder: a bill that
 * is two weeks late should keep showing as overdue rather than silently
 * sliding to the next expected date. The prompt is cleared by
 * `anchorCursorToBill` when the real bill finally lands.
 *
 * Returns true when a reminder was created.
 */
export async function ensureExpectedBillReminder(
  tx: Prisma.TransactionClient,
  args: { workspaceId: string; providerId: string; expectedOn: Date },
): Promise<boolean> {
  const open = await tx.investmentReminder.findFirst({
    where: {
      utilityProviderId: args.providerId,
      kind: ReminderKind.UTILITY_BILL_EXPECTED,
      status: ReminderStatus.UPCOMING,
    },
    select: { id: true },
  });
  if (open) return false;
  await tx.investmentReminder.create({
    data: {
      workspaceId: args.workspaceId,
      utilityProviderId: args.providerId,
      kind: ReminderKind.UTILITY_BILL_EXPECTED,
      dueDate: args.expectedOn,
      status: ReminderStatus.UPCOMING,
    },
  });
  return true;
}
