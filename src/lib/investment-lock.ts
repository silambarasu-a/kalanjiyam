/**
 * Hard-gate edit/delete on a locked Investment.
 *
 * `Investment.lockedUntil` is auto-set on create for FD/RD (= maturityAt),
 * SIP (+3y, ELSS-style), and ULIP-INSURANCE (+5y). The intent is to block
 * everyday edits/deletes during the lock period and force the workspace
 * owner to deliberately unlock before any change.
 *
 * Used by every endpoint that modifies the holding *or* its split
 * transactions — keeps the gate watertight (Members can't bypass by
 * editing the underlying Transaction rows).
 */

type Role = "OWNER" | "ADMIN" | "MEMBER" | "SUPER_ADMIN";

export type InvestmentLockState = {
  lockedUntil: Date | null;
};

/** True when the investment is currently locked AND the role can't override. */
export function isInvestmentLocked(
  inv: InvestmentLockState,
  role: Role,
): boolean {
  if (!inv.lockedUntil) return false;
  if (inv.lockedUntil.getTime() <= Date.now()) return false;
  // Only OWNER and SUPER_ADMIN bypass. ADMIN is gated by design — the
  // user explicitly asked for a hard gate that's owner-only.
  return role !== "OWNER" && role !== "SUPER_ADMIN";
}

/** Return a 423 error message for the locked-until date, or null if not locked. */
export function lockErrorMessage(
  inv: InvestmentLockState,
  role: Role,
  verb: "edit" | "delete" = "edit",
): string | null {
  if (!isInvestmentLocked(inv, role)) return null;
  const date = inv.lockedUntil!.toISOString().slice(0, 10);
  return `Locked until ${date} — only the workspace owner can ${verb}.`;
}
