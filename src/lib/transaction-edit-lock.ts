/**
 * Edit-window enforcement for Transaction PATCH / DELETE.
 *
 * Two rules apply:
 *
 * 1. **Card-account transactions** are locked once the billing period
 *    containing them has closed into a CardStatement. The bill has been
 *    sent to the user — re-writing history would desync the snapshot.
 *
 * 2. **Other-account transactions** (BANK / CASH / WALLET) are locked
 *    once they're older than `Workspace.transactionEditWindowDays` days.
 *    The default is 30; setting the workspace value to 0 disables the
 *    rule entirely.
 *
 * OWNER / ADMIN / SUPER_ADMIN can bypass either rule by passing a
 * `force: true` flag (PATCH body) or `?force=1` query parameter (DELETE).
 * MEMBER role gets no override.
 */

import { prisma } from "@/lib/prisma";
import { isInClosedStatement } from "@/lib/card-statement-service";

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

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function canBypass(role: EditLockRole): boolean {
  return role === "OWNER" || role === "ADMIN" || role === "SUPER_ADMIN";
}

export async function checkTransactionEditAllowed(args: {
  transaction: {
    id: string;
    date: Date;
    accountId: string | null;
    workspaceId: string;
  };
  role: EditLockRole;
  force: boolean;
}): Promise<EditLockResult> {
  const { transaction, role, force } = args;

  // 1. Card-account → statement-close lock.
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

  // 2. Non-card → day-window lock.
  const ws = await prisma.workspace.findUnique({
    where: { id: transaction.workspaceId },
    select: { transactionEditWindowDays: true },
  });
  const window = ws?.transactionEditWindowDays ?? 30;
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
