/**
 * Postgres CHECK-violation detectors for the contact settlement flow.
 *
 * Both constraints live in migration
 * `20260730160000_contact_settle_leftover_and_advance` and exist for the same
 * reason as `UtilityProvider_advanceBalance_nonneg_check`: the route reads a
 * balance, decides the write is legal, and only then writes. Two callers can
 * pass that check against the same snapshot. The atomic `{ increment }` /
 * `{ decrement }` keeps the arithmetic exact; these constraints are what fail
 * the loser instead of letting an over-settle or a negative advance through.
 *
 * Matching is deliberately multi-signal — the pg driver, the
 * `@prisma/adapter-pg` layer and Prisma's own error classes each format CHECK
 * violations differently, and we would rather catch our own constraint under
 * any of those wrappings than let it surface as a 500. Every branch pairs the
 * SQLSTATE with a column name so an unrelated CHECK is never misclassified.
 */

export const CHARGE_OVERSETTLE_MESSAGE =
  "This charge was settled while you were working on it — please refresh and try again.";

export const CONTACT_ADVANCE_MESSAGE =
  "Advance credit changed while you were applying it — please refresh and try again.";

function isCheckViolationFor(e: unknown, constraint: string, column: string): boolean {
  if (!(e instanceof Error)) return false;
  const msg = String(e.message ?? "");
  if (msg.includes(constraint)) return true;
  if (msg.includes("23514") && msg.includes(column)) return true;
  if (/check constraint/i.test(msg) && msg.includes(column)) return true;
  return false;
}

/** `settledAmount` would exceed `amount` — a concurrent settle got there first. */
export function isChargeOverSettleViolation(e: unknown): boolean {
  return isCheckViolationFor(
    e,
    "MemberCharge_settled_le_amount_check",
    "settledAmount",
  );
}

/** `advanceHeld` / `advancePaid` would go negative — credit already spent. */
export function isContactAdvanceViolation(e: unknown): boolean {
  return (
    isCheckViolationFor(e, "Contact_advanceHeld_nonneg_check", "advanceHeld") ||
    isCheckViolationFor(e, "Contact_advancePaid_nonneg_check", "advancePaid")
  );
}
