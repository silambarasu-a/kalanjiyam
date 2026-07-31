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
 * Stable identity of a billing cycle: the calendar month it CLOSES in.
 *
 * A cycle's exact `periodStart` moves whenever the user corrects the
 * card's `statementDate` (12 → 15 turns "13 Apr – 12 May" into "16 Apr –
 * 15 May"), so keying statements by `periodStart` makes the materializer
 * miss the row it already wrote and mint a duplicate bill for the same
 * month. The close month survives that edit — every cycle closes exactly
 * once per calendar month whatever the statement day is.
 */
function cycleKey(periodEnd: Date): string {
  return `${periodEnd.getUTCFullYear()}-${periodEnd.getUTCMonth()}`;
}

/**
 * Close date of the cycle still OPEN on `asOf`. Anything ending strictly
 * before this has finalised into a statement; anything ending on/after it
 * hasn't closed yet.
 */
function openCycleEnd(asOf: Date, statementDate: number): Date {
  const y = asOf.getUTCFullYear();
  let m = asOf.getUTCMonth();
  if (asOf.getUTCDate() > statementDate) m += 1;
  return utcDay(y, m, clampToMonth(y, m, statementDate));
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

/** The fields the materializer needs to place an existing row on a cycle. */
type StatementAnchor = {
  id: string;
  periodStart: Date;
  periodEnd: Date;
  paidAt: Date | null;
  manuallyEdited: boolean;
};

/** Shape used to rank duplicate rows against each other. */
type DuplicateCandidate = {
  id: string;
  periodStart: Date;
  periodEnd: Date;
  totalDue: Prisma.Decimal;
  paidAt: Date | null;
  manuallyEdited: boolean;
  createdAt: Date;
  _count: { payments: number };
};

/**
 * How much of the user's own work a row carries. Highest wins the merge —
 * a settled bill outranks one with payments against it, which outranks a
 * hand-corrected one, which outranks a purely system-generated row.
 */
function keeperRank(s: DuplicateCandidate): number {
  return (
    (s.paidAt ? 4 : 0) +
    (s._count.payments > 0 ? 2 : 0) +
    (s.manuallyEdited ? 1 : 0)
  );
}

function byKeeperPreference(a: DuplicateCandidate, b: DuplicateCandidate): number {
  const rank = keeperRank(b) - keeperRank(a);
  if (rank !== 0) return rank;
  const payments = b._count.payments - a._count.payments;
  if (payments !== 0) return payments;
  const due = Number(b.totalDue) - Number(a.totalDue);
  if (due !== 0) return due;
  return a.createdAt.getTime() - b.createdAt.getTime();
}

/**
 * Fold `loserIds` into `keeperId`: every payment, reminder and uploaded
 * bill scan pointing at a duplicate is re-pointed at the survivor before
 * the duplicates are dropped, so no money movement is orphaned.
 * `Transfer.statementId` is onDelete:SetNull — deleting first would
 * silently untag the payments instead of moving them.
 */
async function mergeStatementRows(
  keeperId: string,
  loserIds: string[],
): Promise<void> {
  if (loserIds.length === 0) return;
  await prisma.$transaction(async (tx) => {
    await tx.transfer.updateMany({
      where: { statementId: { in: loserIds } },
      data: { statementId: keeperId },
    });
    await tx.investmentReminder.updateMany({
      where: { cardStatementId: { in: loserIds } },
      data: { cardStatementId: keeperId },
    });
    // Attachments hang off the polymorphic (ownerKind, ownerId) soft FK,
    // so they need moving by hand — no cascade covers them.
    await tx.attachment.updateMany({
      where: { ownerKind: "CARD_STATEMENT", ownerId: { in: loserIds } },
      data: { ownerId: keeperId },
    });
    await tx.cardStatement.deleteMany({ where: { id: { in: loserIds } } });
  });
}

/**
 * Group an account's statements by billing cycle and report every cycle
 * holding more than one row — the wreckage left by a statement-date edit
 * made before close-month keying existed. Read-only; used both by
 * `dedupeStatementsFor` and by the cleanup script's dry run.
 */
export async function findDuplicateStatementGroups(
  accountId: string,
): Promise<Array<{ keeper: DuplicateCandidate; losers: DuplicateCandidate[] }>> {
  const rows = await prisma.cardStatement.findMany({
    where: { accountId },
    orderBy: { periodEnd: "asc" },
    select: {
      id: true,
      periodStart: true,
      periodEnd: true,
      totalDue: true,
      paidAt: true,
      manuallyEdited: true,
      createdAt: true,
      _count: { select: { payments: true } },
    },
  });
  if (rows.length < 2) return [];
  const byCycle = new Map<string, DuplicateCandidate[]>();
  for (const row of rows) {
    const key = cycleKey(row.periodEnd);
    const group = byCycle.get(key);
    if (group) group.push(row);
    else byCycle.set(key, [row]);
  }
  const out: Array<{ keeper: DuplicateCandidate; losers: DuplicateCandidate[] }> = [];
  for (const group of byCycle.values()) {
    if (group.length < 2) continue;
    const [keeper, ...losers] = [...group].sort(byKeeperPreference);
    out.push({ keeper, losers });
  }
  return out;
}

/**
 * Collapse every duplicated billing cycle on an account down to one row.
 * Returns the number of rows removed. Idempotent — a clean account is a
 * no-op.
 */
export async function dedupeStatementsFor(accountId: string): Promise<number> {
  const groups = await findDuplicateStatementGroups(accountId);
  let removed = 0;
  for (const { keeper, losers } of groups) {
    await mergeStatementRows(
      keeper.id,
      losers.map((l) => l.id),
    );
    removed += losers.length;
    await recomputeStatementPaidAt(keeper.id);
  }
  return removed;
}

/**
 * Move the statement date FORWARD (12 → 15) and a bill generated on the
 * 12th belongs to a cycle that hasn't closed yet. Drop those rows so the
 * bill reappears — with the right boundaries — once the new date passes.
 *
 * Only untouched rows go: anything paid, part-paid, hand-corrected or
 * carrying an uploaded bill scan is left exactly where it is.
 */
async function dropReopenedStatements(
  accountId: string,
  liveCloseEnd: Date,
): Promise<number> {
  const candidates = await prisma.cardStatement.findMany({
    where: {
      accountId,
      paidAt: null,
      manuallyEdited: false,
      periodEnd: { gte: liveCloseEnd },
    },
    select: { id: true, _count: { select: { payments: true } } },
  });
  const ids = candidates
    .filter((c) => c._count.payments === 0)
    .map((c) => c.id);
  if (ids.length === 0) return 0;
  const attached = await prisma.attachment.findMany({
    where: { ownerKind: "CARD_STATEMENT", ownerId: { in: ids } },
    select: { ownerId: true },
  });
  const blocked = new Set(attached.map((a) => a.ownerId));
  const removable = ids.filter((id) => !blocked.has(id));
  if (removable.length === 0) return 0;
  const res = await prisma.cardStatement.deleteMany({
    where: { id: { in: removable } },
  });
  return res.count;
}

/**
 * Clear the way to move a row onto `periodStart`, which the (accountId,
 * periodStart) unique constraint may already have someone sitting on.
 * Returns false when the squatter is a settled bill — a paid statement is
 * an immutable record, so we abandon the re-anchor rather than destroy it.
 */
async function claimPeriodStart(
  accountId: string,
  periodStart: Date,
  keeperId: string,
): Promise<{ ok: boolean; mergedId: string | null }> {
  const clash = await prisma.cardStatement.findUnique({
    where: { accountId_periodStart: { accountId, periodStart } },
    select: { id: true, paidAt: true },
  });
  if (!clash || clash.id === keeperId) return { ok: true, mergedId: null };
  if (clash.paidAt) return { ok: false, mergedId: null };
  await mergeStatementRows(keeperId, [clash.id]);
  return { ok: true, mergedId: clash.id };
}

/**
 * Idempotently maintain CardStatement rows for every closed billing cycle
 * up to (but not including) the cycle that's still open today. Safe to
 * call repeatedly.
 *
 * Cycles are matched to existing rows by CLOSE MONTH, not by periodStart,
 * so editing the card's statement date re-anchors the bill that's already
 * there instead of generating a second one alongside it. Within a cycle:
 *
 *   - paid          → untouched (a settled bill is history), and its own
 *                     periodEnd anchors the next cycle's start
 *   - manuallyEdited→ period re-anchored, but the user's totalDue /
 *                     dueDate are left alone
 *   - otherwise     → period + dueDate + totalDue all re-snapshotted
 *
 * Each cycle starts the day after the previous one closed, so moving the
 * statement date leaves neither a gap nor an overlap in what gets billed.
 *
 * Returns the number of new statements created (re-anchored rows don't
 * count — they're not new bills and don't re-notify).
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

  const sd = account.statementDate;
  const grace = account.gracePeriod ?? 0;

  // Heal first, walk second. Both passes assume at most one row per
  // billing cycle, which is exactly what a pre-fix statement-date edit
  // could have broken.
  await dedupeStatementsFor(accountId);
  // Guard the reopen check with the REAL current date, never `asOf` — the
  // transfers route materialises as-of a (possibly back-dated) payment,
  // and judging "hasn't closed yet" from that date would delete every
  // statement written since.
  await dropReopenedStatements(accountId, openCycleEnd(new Date(), sd));

  // Anchor the back-fill at the earliest transaction on this card. Without
  // a transaction history there's no statement to build.
  const earliest = await prisma.transaction.findFirst({
    where: { accountId },
    orderBy: { date: "asc" },
    select: { date: true },
  });
  if (!earliest) return 0;

  // Walk every month from the month containing the earliest transaction
  // through the month BEFORE the currently-open cycle (which closes in
  // the future and isn't a finalised statement yet).
  const openCloseEnd = openCycleEnd(asOf, sd);

  // Existing rows keyed by the month their cycle closes in — the identity
  // that survives a statement-date edit.
  const existingRows = await prisma.cardStatement.findMany({
    where: { accountId },
    select: {
      id: true,
      periodStart: true,
      periodEnd: true,
      paidAt: true,
      manuallyEdited: true,
    },
  });
  const byCycle = new Map<string, StatementAnchor>();
  for (const row of existingRows) byCycle.set(cycleKey(row.periodEnd), row);

  // History boundary: the newest settled bill. Everything closing at or
  // before it is finished business — its totals still get re-snapshotted
  // (a transaction can still be back-dated into it) but its period is
  // never re-cut, because moving a bill that sits right behind a paid one
  // would overlap the days that bill already charged for. Only the live
  // tail after it follows the new statement date.
  const newestPaid = await prisma.cardStatement.findFirst({
    where: { accountId, paidAt: { not: null } },
    orderBy: { periodEnd: "desc" },
    select: { periodEnd: true },
  });
  const frozenThrough = newestPaid?.periodEnd ?? null;

  let cursorY = earliest.date.getUTCFullYear();
  let cursorM = earliest.date.getUTCMonth();
  let created = 0;
  const newlyCreated: Array<{
    periodStart: Date;
    periodEnd: Date;
    dueDate: Date;
    totalDue: number;
  }> = [];
  // Close date of the cycle we settled last iteration; the next cycle
  // starts the day after it. Keeps the transition cycle around a
  // statement-date change gap-free and overlap-free.
  let prevEnd: Date | null = null;
  // Hard cap to avoid runaway loops on bad data — 240 months ≈ 20 years.
  for (let i = 0; i < 240; i++) {
    const cycle = cycleEndingIn(cursorY, cursorM, sd);
    const stepMonth = () => {
      cursorM += 1;
      if (cursorM > 11) {
        cursorM = 0;
        cursorY += 1;
      }
    };
    if (cycle.end.getTime() >= openCloseEnd.getTime()) break;

    let existing: StatementAnchor | null =
      byCycle.get(cycleKey(cycle.end)) ?? null;

    // Behind the newest settled bill: keep the period exactly as billed,
    // only refresh the amount. A cycle with no row here is left alone —
    // inventing one now, with today's boundaries, would straddle the
    // settled bill next to it.
    if (frozenThrough && cycle.end.getTime() <= frozenThrough.getTime()) {
      if (existing) {
        if (!existing.paidAt && !existing.manuallyEdited) {
          await prisma.cardStatement.update({
            where: { id: existing.id },
            data: {
              totalDue: await computeStatementTotalDue(
                accountId,
                existing.periodStart,
                existing.periodEnd,
              ),
              dueDate: new Date(
                existing.periodEnd.getTime() + grace * ONE_DAY_MS,
              ),
            },
          });
        }
        prevEnd = existing.periodEnd;
      } else {
        prevEnd = cycle.end;
      }
      stepMonth();
      continue;
    }

    // A paid bill is a historical record — never re-anchor or re-snapshot
    // it (same rule the edit + regenerate routes enforce with a 423). It
    // still anchors the next cycle, so the days between the old and the
    // new statement date get billed exactly once.
    if (existing?.paidAt) {
      prevEnd = existing.periodEnd;
      stepMonth();
      continue;
    }

    const start: Date = prevEnd
      ? new Date(prevEnd.getTime() + ONE_DAY_MS)
      : cycle.start;
    // A large backwards move of the statement date can leave the previous
    // (immutable) statement already covering this whole cycle. Nothing
    // left to bill.
    if (start.getTime() > cycle.end.getTime()) {
      stepMonth();
      continue;
    }

    // Nothing matched by close month, but the (accountId, periodStart)
    // unique key may still be occupied — by a row whose periodEnd landed
    // in an adjacent month. Adopt it rather than colliding with it.
    if (!existing) {
      existing = await prisma.cardStatement.findUnique({
        where: { accountId_periodStart: { accountId, periodStart: start } },
        select: {
          id: true,
          periodStart: true,
          periodEnd: true,
          paidAt: true,
          manuallyEdited: true,
        },
      });
      if (existing?.paidAt) {
        prevEnd = existing.periodEnd;
        stepMonth();
        continue;
      }
    }

    if (existing) {
      const moved =
        existing.periodStart.getTime() !== start.getTime() ||
        existing.periodEnd.getTime() !== cycle.end.getTime();
      const claim = moved
        ? await claimPeriodStart(accountId, start, existing.id)
        : { ok: true, mergedId: null };
      // A row folded into this one is gone from the DB — drop it from the
      // cycle map too, or a later iteration would update a deleted id.
      if (claim.mergedId) {
        for (const [key, row] of byCycle) {
          if (row.id === claim.mergedId) byCycle.delete(key);
        }
      }
      if (!claim.ok) {
        prevEnd = existing.periodEnd;
        stepMonth();
        continue;
      }
      if (existing.manuallyEdited) {
        // The user owns totalDue / dueDate on this row — re-anchor the
        // period only, so the cycle isn't materialised a second time but
        // their correction survives.
        if (moved) {
          await prisma.cardStatement.update({
            where: { id: existing.id },
            data: {
              periodStart: start,
              periodEnd: cycle.end,
              closedAt: cycle.end,
            },
          });
        }
      } else {
        // Re-snapshot the totals every time we materialise — guards
        // against the rare edge where a transaction was back-dated into
        // a closed period before the lock kicked in, and re-bills the
        // cycle correctly when its boundaries just moved.
        const totalDue = await computeStatementTotalDue(
          accountId,
          start,
          cycle.end,
        );
        await prisma.cardStatement.update({
          where: { id: existing.id },
          data: {
            periodStart: start,
            periodEnd: cycle.end,
            dueDate: new Date(cycle.end.getTime() + grace * ONE_DAY_MS),
            totalDue,
            closedAt: cycle.end,
          },
        });
      }
    } else {
      const totalDue = await computeStatementTotalDue(
        accountId,
        start,
        cycle.end,
      );
      const dueDate = new Date(cycle.end.getTime() + grace * ONE_DAY_MS);
      await prisma.cardStatement.create({
        data: {
          workspaceId: account.workspaceId,
          accountId,
          periodStart: start,
          periodEnd: cycle.end,
          dueDate,
          totalDue,
          closedAt: cycle.end,
        },
        select: { id: true },
      });
      created += 1;
      newlyCreated.push({
        periodStart: start,
        periodEnd: cycle.end,
        dueDate,
        totalDue,
      });
    }

    prevEnd = cycle.end;
    stepMonth();
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
