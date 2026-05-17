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
import { NotificationKind, Prisma } from "@/generated/prisma/client";
import { createNotification } from "@/lib/notifications";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Compute the bill total for a single (account, [start, end]) period from
 * the live transaction ledger. Matches the materializer's "owed" definition:
 * EXPENSE plus INVESTMENT BUY (e.g. a gold purchase swiped on the card both
 * grows the card outstanding), minus INCOME (refunds back to the card).
 * Bill-payment transfers are excluded — they're tracked via Transfer.statementId.
 */
export async function computeStatementTotalDue(
  accountId: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<number> {
  const periodFilter = {
    accountId,
    date: { gte: periodStart, lt: new Date(periodEnd.getTime() + ONE_DAY_MS) },
  };
  const [expenseAgg, incomeAgg] = await Promise.all([
    prisma.transaction.aggregate({
      where: {
        ...periodFilter,
        OR: [
          { type: "EXPENSE" as const, transferId: null },
          {
            type: "INVESTMENT" as const,
            investmentAction: "BUY" as const,
            transferId: null,
          },
        ],
      },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: { ...periodFilter, type: "INCOME" as const, transferId: null },
      _sum: { amount: true },
    }),
  ]);
  const expense = Number(expenseAgg._sum.amount ?? 0);
  const income = Number(incomeAgg._sum.amount ?? 0);
  return Math.max(0, expense - income);
}

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
      ownerUserId: true,
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
  const openCloseY = todayY;
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
  const newlyCreated: Array<{
    periodStart: Date;
    periodEnd: Date;
    dueDate: Date;
    totalDue: number;
  }> = [];
  // Hard cap to avoid runaway loops on bad data — 240 months ≈ 20 years.
  for (let i = 0; i < 240; i++) {
    const cycle = cycleEndingIn(cursorY, cursorM, sd);
    if (cycle.end.getTime() >= openCloseEnd.getTime()) break;

    // Explicit find→create/update (instead of upsert) so we know with
    // certainty whether this iteration produced a new row. The new-row
    // signal drives the statement-generated notification below.
    // Look the row up FIRST so we can skip the aggregate queries entirely
    // for manually-edited rows we wouldn't overwrite anyway.
    const existing = await prisma.cardStatement.findUnique({
      where: {
        accountId_periodStart: { accountId, periodStart: cycle.start },
      },
      select: { id: true, manuallyEdited: true },
    });
    // Rows the user has hand-edited (totalDue / dueDate corrected via the
    // edit-statement dialog) are owned by the user; overwriting them here
    // would wipe their fix on the next cron tick.
    if (!existing?.manuallyEdited) {
      const totalDue = await computeStatementTotalDue(
        accountId,
        cycle.start,
        cycle.end,
      );
      const dueDate = new Date(cycle.end.getTime() + grace * ONE_DAY_MS);
      if (existing) {
        // Re-snapshot the totals every time we materialise — guards
        // against the rare edge where a transaction was back-dated into
        // a closed period before the lock kicked in.
        await prisma.cardStatement.update({
          where: { id: existing.id },
          data: { periodEnd: cycle.end, dueDate, totalDue },
        });
      } else {
        await prisma.cardStatement.create({
          data: {
            workspaceId: account.workspaceId,
            accountId,
            periodStart: cycle.start,
            periodEnd: cycle.end,
            dueDate,
            totalDue,
            closedAt: cycle.end,
          },
          select: { id: true },
        });
        created += 1;
        newlyCreated.push({
          periodStart: cycle.start,
          periodEnd: cycle.end,
          dueDate,
          totalDue,
        });
      }
    }

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

  // Fire one notification per freshly-generated statement. Targeted at
  // the card's owner when known; otherwise broadcast to the workspace
  // (recipient filtering then trims it to members with `cards` access).
  if (newlyCreated.length > 0) {
    const card = await prisma.card.findFirst({
      where: { accountId },
      select: { id: true, name: true },
    });
    const cardName = card?.name ?? "Card";
    const cardLink = card ? `/cards/${card.id}` : "/cards";
    for (const s of newlyCreated) {
      const dueOn = s.dueDate.toISOString().slice(0, 10);
      const amount = `₹${Number(s.totalDue).toLocaleString("en-IN")}`;
      await createNotification({
        workspaceId: account.workspaceId,
        userId: account.ownerUserId ?? null,
        kind: NotificationKind.CARD_STATEMENT_DUE,
        title: `${cardName} statement generated · ${amount} due`,
        body: `Billing cycle ${s.periodStart.toISOString().slice(0, 10)} → ${s.periodEnd
          .toISOString()
          .slice(0, 10)}. Payment due by ${dueOn}.`,
        link: cardLink,
      });
    }
  }

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
