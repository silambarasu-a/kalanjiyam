/**
 * Detect the Postgres CHECK violation thrown when a bill-pay /
 * advance-decrement transaction would push `UtilityProvider.advanceBalance`
 * below zero. The constraint is defined in migration
 * `20260520120000_advance_balance_check`. Two concurrent pays can each
 * read the same available balance and both attempt to decrement; the
 * losing transaction trips the CHECK and we surface a friendly retry
 * message rather than a 500.
 */
export const ADVANCE_NONNEG_MESSAGE =
  "Advance balance changed while you were paying — please refresh and try again.";

export function isAdvanceNonNegViolation(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const msg = String(e.message ?? "");
  // Match defensively across Prisma 7's possible wrappings. The pg
  // driver, the @prisma/adapter-pg layer, and Prisma's own
  // ClientKnown/UnknownRequestError each format CHECK violations
  // slightly differently — any of these signals confirms it's *our*
  // constraint and not some unrelated failure we'd want to surface as
  // 500.
  if (msg.includes("UtilityProvider_advanceBalance_nonneg_check")) return true;
  if (msg.includes("advanceBalance_nonneg")) return true;
  // Postgres SQLSTATE for check_violation. Some Prisma error wrappers
  // include it in the message; pair with the column name so we don't
  // misclassify an unrelated CHECK constraint as this one.
  if (msg.includes("23514") && msg.includes("advanceBalance")) return true;
  // Final fallback: any check-constraint message that mentions our
  // column. Covers wording like "violates check constraint" / "new row
  // for relation … violates …" across pg versions.
  if (
    /check constraint/i.test(msg) &&
    msg.includes("advanceBalance")
  ) {
    return true;
  }
  return false;
}
