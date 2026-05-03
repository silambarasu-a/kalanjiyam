/**
 * Edit-window enforcement for Transaction PATCH / DELETE.
 *
 * Three rules apply, in order:
 *
 * 1. **Closed-loan lock** — once a loan auto-closes (last EMI paid,
 *    outstanding=0), every transaction pinned to that loan is frozen,
 *    EXCEPT the most-recent EMI payment within `TIMING.loanEmiGraceDays` of
 *    its paid date. Lets the user undo a wrong final payment, but the
 *    historical record stays immutable after the grace window.
 *
 * 2. **Card-account transactions** are locked once the billing period
 *    containing them has closed into a CardStatement. The bill has been
 *    sent to the user — re-writing history would desync the snapshot.
 *
 * 3. **Other-account transactions** (BANK / CASH / WALLET) are locked
 *    once they're older than `Workspace.transactionEditWindowDays` days.
 *    The default is 30; setting the workspace value to 0 disables the
 *    rule entirely.
 *
 * OWNER / ADMIN / SUPER_ADMIN can bypass any rule by passing a
 * `force: true` flag (PATCH body) or `?force=1` query parameter (DELETE).
 * MEMBER role gets no override.
 */

import { prisma } from "@/lib/prisma";
import { isInClosedStatement } from "@/lib/card-statement-service";
import { TIMING, ONE_DAY_MS } from "@/lib/timing";

export type EditLockRole =
  | "OWNER"
  | "ADMIN"
  | "MEMBER"
  | "SUPER_ADMIN"
  | string;

export type EditLockResult =
  | { ok: true }
  | {
      ok: false;
      status: 423; // Locked
      message: string;
      canForce: boolean;
    };

function canBypass(role: EditLockRole): boolean {
  return role === "OWNER" || role === "ADMIN" || role === "SUPER_ADMIN";
}

export async function checkTransactionEditAllowed(args: {
  transaction: {
    id: string;
    date: Date;
    accountId: string | null;
    workspaceId: string;
    /** Set when the txn is pinned to a Loan (disbursement, charges, EMI). */
    loanId?: string | null;
    /** Required when `loanId` is set, to identify the closing EMI. */
    type?: "INCOME" | "EXPENSE" | "TRANSFER" | string | null;
    kind?: string | null;
  };
  role: EditLockRole;
  force: boolean;
}): Promise<EditLockResult> {
  const { transaction, role, force } = args;

  // 1. Loan-closed lock.
  if (transaction.loanId) {
    const loan = await prisma.loan.findUnique({
      where: { id: transaction.loanId },
      select: { active: true },
    });
    if (loan && !loan.active) {
      const isEmiPayment =
        transaction.type === "EXPENSE" && transaction.kind === "LOAN_PAYMENT";
      // Find the latest EMI payment for this loan; that's the only one
      // eligible for the 3-day grace window. Tiebreaker on createdAt so
      // two same-day EMIs resolve deterministically (truly last-inserted
      // wins) instead of flipping between page loads.
      const latestPayment = isEmiPayment
        ? await prisma.transaction.findFirst({
            where: {
              loanId: transaction.loanId,
              type: "EXPENSE",
              kind: "LOAN_PAYMENT",
            },
            orderBy: [{ date: "desc" }, { createdAt: "desc" }],
            select: { id: true, date: true },
          })
        : null;
      const isLatestEmi = latestPayment?.id === transaction.id;
      const ageDaysSincePaid = latestPayment
        ? Math.floor(
            (Date.now() - latestPayment.date.getTime()) / ONE_DAY_MS,
          )
        : Number.POSITIVE_INFINITY;
      const inGrace =
        isLatestEmi && ageDaysSincePaid <= TIMING.loanEmiGraceDays;
      if (!inGrace) {
        if (force && canBypass(role)) return { ok: true };
        const overrideHint = canBypass(role)
          ? " Re-submit with force=true to override."
          : " Ask an Owner or Admin to override.";
        const message = !isEmiPayment
          ? `This loan is closed; its disbursement and charges are locked.${overrideHint}`
          : isLatestEmi
            ? `The closing EMI is past its ${TIMING.loanEmiGraceDays}-day grace window (paid ${ageDaysSincePaid} days ago).${overrideHint}`
            : `This loan is closed. Only the closing EMI can be reversed, and only within ${TIMING.loanEmiGraceDays} days of payment.${overrideHint}`;
        return {
          ok: false,
          status: 423,
          message,
          canForce: canBypass(role),
        };
      }
      // Closing EMI inside grace window — skip the remaining rules so the
      // workspace edit-window doesn't lock the same row a second time.
      return { ok: true };
    }
  }

  // 2. Card-account → statement-close lock.
  if (transaction.accountId) {
    const account = await prisma.account.findUnique({
      where: { id: transaction.accountId },
      select: { kind: true },
    });
    if (account?.kind === "CARD") {
      const closed = await isInClosedStatement(
        transaction.accountId,
        transaction.date,
      );
      if (closed) {
        if (force && canBypass(role)) return { ok: true };
        return {
          ok: false,
          status: 423,
          message:
            "This transaction's billing cycle has been closed and statement archived. " +
            (canBypass(role)
              ? "Re-submit with force=true to override."
              : "Ask an Owner or Admin to override."),
          canForce: canBypass(role),
        };
      }
      // Card transaction in still-open cycle is editable regardless of
      // the day window — the cycle hasn't been billed yet.
      return { ok: true };
    }
  }

  // 3. Non-card → day-window lock. Per-workspace override wins; falls back
  // to the env-driven default in TIMING.defaultEditWindowDays.
  const ws = await prisma.workspace.findUnique({
    where: { id: transaction.workspaceId },
    select: { transactionEditWindowDays: true },
  });
  const window =
    ws?.transactionEditWindowDays ?? TIMING.defaultEditWindowDays;
  if (window <= 0) return { ok: true };
  const ageDays = Math.floor(
    (Date.now() - transaction.date.getTime()) / ONE_DAY_MS,
  );
  if (ageDays > window) {
    if (force && canBypass(role)) return { ok: true };
    return {
      ok: false,
      status: 423,
      message: `This transaction is ${ageDays} days old; the workspace allows edits only within ${window} days. ` +
        (canBypass(role)
          ? "Re-submit with force=true to override."
          : "Ask an Owner or Admin to override."),
      canForce: canBypass(role),
    };
  }
  return { ok: true };
}

/**
 * Same day-window rule, applied to non-Transaction rows that should
 * follow the workspace's edit-window setting (attendance, future log
 * entries, etc.). The caller passes the row's `date` and `workspaceId`;
 * we use the per-workspace `transactionEditWindowDays` (with env
 * fallback) as the lock threshold.
 *
 * `entityName` is used in the error message — e.g. "attendance entry".
 */
export async function checkDayWindowEditAllowed(args: {
  date: Date;
  workspaceId: string;
  role: EditLockRole;
  force: boolean;
  entityName: string;
}): Promise<EditLockResult> {
  const { date, workspaceId, role, force, entityName } = args;
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { transactionEditWindowDays: true },
  });
  const window =
    ws?.transactionEditWindowDays ?? TIMING.defaultEditWindowDays;
  if (window <= 0) return { ok: true };
  const ageDays = Math.floor((Date.now() - date.getTime()) / ONE_DAY_MS);
  if (ageDays <= window) return { ok: true };
  if (force && canBypass(role)) return { ok: true };
  return {
    ok: false,
    status: 423,
    message:
      `This ${entityName} is ${ageDays} days old; the workspace allows edits only within ${window} days. ` +
      (canBypass(role)
        ? "Re-submit with force=true to override."
        : "Ask an Owner or Admin to override."),
    canForce: canBypass(role),
  };
}
