/**
 * Credit-card statement bookkeeping.
 *
 * A "statement" is a snapshot of one billing cycle: its date range, the
 * total amount due (sum of card spend during that period), the due date,
 * and the cumulative payments made against it. We persist these as
 * `CardStatement` rows once the cycle closes so the bill is preserved
 * even if individual transactions are later edited or deleted within the
 * window the system still allows.
 *
 * Materialisation is lazy and idempotent — `materializeStatementsFor` is
 * called when the card detail page loads, and it `upsert`s any missing
 * past cycles based on the account's `statementDate` + `gracePeriod`.
 *
 * Payments (transfers into the card account) are tagged via
 * `Transfer.statementId` so the user can see exactly which bill each
 * payment cleared. Tagging picks the oldest still-unpaid statement
 * whose due date is on or after the payment date — i.e. the bill the
 * user was almost certainly paying.
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function utcDay(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day));
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function clampToMonth(year: number, month: number, day: number): number {
  return Math.min(day, lastDayOfMonth(year, month));
}

/**
 * Returns the (start, end] cycle that ends on `statementDate` of `month`,
 * inclusive on both sides. start = day after the previous cycle's close;
 * end = closeDay of this month.
 */
function cycleEndingIn(
  year: number,
  month: number,
  statementDate: number,
): { start: Date; end: Date } {
  const end = utcDay(year, month, clampToMonth(year, month, statementDate));
  let prevY = year;
  let prevM = month - 1;
  if (prevM < 0) {
    prevM = 11;
    prevY -= 1;
  }
  const startDay = clampToMonth(prevY, prevM, statementDate) + 1;
  // start = day after previous close. If startDay overflows the previous
  // month, roll into the current month on day 1.
  if (startDay > lastDayOfMonth(prevY, prevM)) {
    return { start: utcDay(year, month, 1), end };
  }
  return { start: utcDay(prevY, prevM, startDay), end };
}

/**
 * Idempotently create CardStatement rows for every closed billing cycle
 * up to (but not including) the cycle that's still open today. Safe to
 * call repeatedly — duplicates are blocked by the (accountId,
 * periodStart) unique constraint.
 *
 * Returns the number of new statements created.
 */
export async function materializeStatementsFor(
  accountId: string,
  asOf: Date = new Date(),
): Promise<number> {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: {
      id: true,
      kind: true,
      workspaceId: true,
      statementDate: true,
      gracePeriod: true,
    },
  });
  if (!account || account.kind !== "CARD" || account.statementDate == null) {
    return 0;
  }

  // Anchor the back-fill at the earliest transaction on this card. Without
  // a transaction history there's no statement to build.
  const earliest = await prisma.transaction.findFirst({
    where: { accountId },
    orderBy: { date: "asc" },
    select: { date: true },
  });
  if (!earliest) return 0;

  const sd = account.statementDate;
  const grace = account.gracePeriod ?? 0;

  // Walk every month from the month containing the earliest transaction
  // through the month BEFORE the currently-open cycle (which closes in
  // the future and isn't a finalised statement yet).
  const todayY = asOf.getUTCFullYear();
  const todayM = asOf.getUTCMonth();
  const todayD = asOf.getUTCDate();
  // The currently-open cycle closes on `sd` of this month if today <= sd,
  // otherwise of next month. Anything ending strictly before that close
  // is finalised.
  let openCloseY = todayY;
  let openCloseM = todayM;
  if (todayD > sd) openCloseM += 1;
  const openCloseEnd = utcDay(
    openCloseY,
    openCloseM,
    clampToMonth(openCloseY, openCloseM, sd),
  );

  let cursorY = earliest.date.getUTCFullYear();
  let cursorM = earliest.date.getUTCMonth();
  let created = 0;
  // Hard cap to avoid runaway loops on bad data — 240 months ≈ 20 years.
  for (let i = 0; i < 240; i++) {
    const cycle = cycleEndingIn(cursorY, cursorM, sd);
    if (cycle.end.getTime() >= openCloseEnd.getTime()) break;

    // totalDue = sum of expense-side activity in [start, end] inclusive.
    // This includes EXPENSE transactions and OUT-leg TRANSFER transactions
    // posted on the card. INCOME (e.g. refunds, statement payments) is
    // NOT subtracted here — payments are tracked separately via
    // Transfer.statementId so the user can see partial payments. Refunds
    // recorded as INCOME on the card reduce the period's net spend, so
    // we do subtract them.
    const periodFilter = {
      accountId,
      date: { gte: cycle.start, lt: new Date(cycle.end.getTime() + ONE_DAY_MS) },
    };
    const [expenseAgg, incomeAgg] = await Promise.all([
      prisma.transaction.aggregate({
        where: { ...periodFilter, type: "EXPENSE" },
        _sum: { amount: true },
      }),
      prisma.transaction.aggregate({
        where: { ...periodFilter, type: "INCOME" },
        _sum: { amount: true },
      }),
    ]);
    const expense = Number(expenseAgg._sum.amount ?? 0);
    const income = Number(incomeAgg._sum.amount ?? 0);
    const totalDue = Math.max(0, expense - income);

    const dueDate = new Date(cycle.end.getTime() + grace * ONE_DAY_MS);

    const result = await prisma.cardStatement.upsert({
      where: {
        accountId_periodStart: {
          accountId,
          periodStart: cycle.start,
        },
      },
      create: {
        workspaceId: account.workspaceId,
        accountId,
        periodStart: cycle.start,
        periodEnd: cycle.end,
        dueDate,
        totalDue,
        closedAt: cycle.end,
      },
      update: {
        // Re-snapshot the totals every time we materialise — guards
        // against the rare edge where a transaction was back-dated into
        // a closed period before the lock kicked in.
        periodEnd: cycle.end,
        dueDate,
        totalDue,
      },
      select: { id: true, createdAt: true },
    });
    if (result.createdAt.getTime() > Date.now() - 5_000) created += 1;

    // Step forward one month.
    cursorM += 1;
    if (cursorM > 11) {
      cursorM = 0;
      cursorY += 1;
    }
  }

  // After (re-)materialisation, recompute paidAt for each affected
  // statement so newly-tagged payments are reflected.
  const statements = await prisma.cardStatement.findMany({
    where: { accountId },
    select: { id: true },
  });
  await Promise.all(statements.map((s) => recomputeStatementPaidAt(s.id)));

  return created;
}

/**
 * Pick the right statement to tag a card-account-bound transfer to.
 * Strategy: the oldest unpaid statement on the account, regardless of
 * whether the payment lands before or after its due date — overdue
 * payments still clear the bill they were owed against. Returns null if
 * no unpaid statement exists yet (e.g. the cycle hasn't been
 * materialised, or this is an over-payment ahead of any bill).
 */
export async function findStatementForPayment(
  accountId: string,
): Promise<string | null> {
  const candidate = await prisma.cardStatement.findFirst({
    where: { accountId, paidAt: null },
    orderBy: { periodStart: "asc" },
    select: { id: true },
  });
  return candidate?.id ?? null;
}

/**
 * Sum of transfers landing on a card account that aren't tagged to any
 * materialised statement. Used to net out partial payments against a
 * manual-override or computed-fallback bill — those paths can't rely on
 * `Transfer.statementId` because no `CardStatement` row exists yet.
 *
 * `upToDate` clamps to payments at-or-before the bill due date so we
 * don't bleed future payments back into the current bill.
 */
export async function untaggedPaymentsToCard(
  accountId: string,
  upToDate: Date,
): Promise<number> {
  const agg = await prisma.transfer.aggregate({
    where: {
      toAccountId: accountId,
      statementId: null,
      date: { lte: upToDate },
    },
    _sum: { amount: true },
  });
  return Number(agg._sum.amount ?? 0);
}

/**
 * Recompute `paidAt` for one statement based on the cumulative tagged
 * payments. Marks paid when the running total covers `totalDue` (down to
 * the rupee — small float drift in Decimal math is tolerated).
 */
export async function recomputeStatementPaidAt(statementId: string): Promise<void> {
  const stmt = await prisma.cardStatement.findUnique({
    where: { id: statementId },
    select: { totalDue: true, paidAt: true, closedAt: true, createdAt: true },
  });
  if (!stmt) return;
  const payments = await prisma.transfer.findMany({
    where: { statementId },
    orderBy: { date: "asc" },
    select: { amount: true, date: true },
  });
  const totalDue = Number(stmt.totalDue);
  let cumulative = 0;
  let paidAt: Date | null = null;
  // Empty cycle (totalDue ≤ 0) — nothing was owed, so the statement is
  // implicitly paid as soon as the cycle closes. Without this, a $0
  // statement stays paidAt:null forever and silently blocks manual-
  // override / fallback paths in the dashboard + notifications.
  if (totalDue <= 0) {
    paidAt = stmt.closedAt ?? stmt.createdAt;
  } else {
    for (const p of payments) {
      cumulative += Number(p.amount);
      if (cumulative + 0.5 >= totalDue) {
        paidAt = p.date;
        break;
      }
    }
  }
  // No-op when the stored value already matches the recomputed one.
  if (
    (paidAt?.getTime() ?? null) !== (stmt.paidAt?.getTime() ?? null)
  ) {
    await prisma.cardStatement.update({
      where: { id: statementId },
      data: { paidAt },
    });
  }
}

/**
 * Returns true if the given transaction date falls inside a closed
 * statement period for the given (card) account. Used by the edit-lock
 * check to refuse mutations on already-billed transactions.
 */
export async function isInClosedStatement(
  accountId: string,
  date: Date,
): Promise<boolean> {
  const stmt = await prisma.cardStatement.findFirst({
    where: {
      accountId,
      periodStart: { lte: date },
      periodEnd: { gte: date },
    },
    select: { id: true },
  });
  return !!stmt;
}

/** Convenience: total still owed across all unpaid statements for a card. */
export async function unpaidTotalForCardAccount(
  accountId: string,
): Promise<number> {
  const agg = await prisma.cardStatement.aggregate({
    where: { accountId, paidAt: null },
    _sum: { totalDue: true },
  });
  const due = Number(agg._sum.totalDue ?? 0);
  // Subtract any already-tagged-but-not-yet-fully-clearing payments.
  const stmts = await prisma.cardStatement.findMany({
    where: { accountId, paidAt: null },
    select: { id: true, totalDue: true },
  });
  let paidPartial = 0;
  for (const s of stmts) {
    const aggP = await prisma.transfer.aggregate({
      where: { statementId: s.id },
      _sum: { amount: true },
    });
    paidPartial += Number(aggP._sum.amount ?? 0);
  }
  return Math.max(0, due - paidPartial);
}

/** Re-export Prisma for migration/seed scripts that need the typed client. */
export { Prisma };
