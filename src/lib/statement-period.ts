/**
 * Statement / period helpers used by the Card and Account detail pages.
 *
 * A "period" is a date range a user filters transactions by. For credit
 * cards with a `statementDate` set it's the billing cycle (e.g. 12 Apr →
 * 11 May). For bank / cash / cards-without-statement-date we fall back to
 * calendar months.
 */

export type Period = {
  /** Stable id like "2026-04-12_2026-05-11" — used as the URL search-param. */
  id: string;
  start: Date; // inclusive, midnight UTC
  end: Date; // inclusive day, midnight UTC of the LAST day in the period
  /** Display label, e.g. "12 Apr — 11 May 2026". */
  label: string;
  /** Sub-label like "Current statement" / "Past month". */
  hint?: string;
};

function utcDay(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day));
}

function fmtDay(d: Date): string {
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function fmtMonth(d: Date): string {
  return d.toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
}

function isoDayId(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Build the last `count` calendar-month periods, newest first. Useful for
 * BANK / CASH accounts and for cards without a configured statement date.
 */
export function calendarMonthPeriods(count = 12, today: Date = new Date()): Period[] {
  const out: Period[] = [];
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  for (let i = 0; i < count; i++) {
    const start = utcDay(y, m - i, 1);
    // Last day of that month = day-0 of next month.
    const end = utcDay(start.getUTCFullYear(), start.getUTCMonth() + 1, 0);
    out.push({
      id: `${isoDayId(start)}_${isoDayId(end)}`,
      start,
      end,
      label: fmtMonth(start),
      hint: i === 0 ? "Current month" : i === 1 ? "Last month" : undefined,
    });
  }
  return out;
}

/**
 * Build credit-card statement-cycle periods.
 *
 *   statementDate = day-of-month the statement closes (1..31)
 *
 * Returns the last `count` cycles, newest first. The newest entry is the
 * still-OPEN cycle — its `end` is `statementDate` of this/next month.
 */
export function cardStatementPeriods(
  statementDate: number,
  count = 12,
  today: Date = new Date(),
): Period[] {
  const out: Period[] = [];
  const sd = Math.max(1, Math.min(31, statementDate));
  const todayY = today.getUTCFullYear();
  const todayM = today.getUTCMonth();
  const todayD = today.getUTCDate();

  // Find the close-day of the CURRENTLY OPEN cycle. If today is on/before
  // sd of this month, the open cycle closes this month; otherwise next.
  let closeY = todayY;
  let closeM = todayM;
  if (todayD > sd) closeM += 1;

  for (let i = 0; i < count; i++) {
    // end = the close day of this cycle (clamped to month length).
    const endMonthLastDay = new Date(Date.UTC(closeY, closeM + 1, 0)).getUTCDate();
    const end = utcDay(closeY, closeM, Math.min(sd, endMonthLastDay));
    // start = day after previous cycle's close = sd+1 of previous month.
    const prevMonthLastDay = new Date(Date.UTC(closeY, closeM, 0)).getUTCDate();
    const start = utcDay(
      closeY,
      closeM - 1,
      Math.min(sd, prevMonthLastDay) + 1,
    );

    out.push({
      id: `${isoDayId(start)}_${isoDayId(end)}`,
      start,
      end,
      label: `${fmtDay(start)} — ${fmtDay(end)}`,
      hint:
        i === 0 ? "Current statement" : i === 1 ? "Last statement" : undefined,
    });

    // Step back one cycle.
    closeM -= 1;
    if (closeM < 0) {
      closeM = 11;
      closeY -= 1;
    }
  }
  return out;
}

/**
 * Due date of the billing cycle that BILLS a transaction posted on `after`.
 *
 * Credit-card loans are repaid through the card's monthly statement: each
 * billing cycle closes on day `statementDate` and the bill is due
 * `gracePeriod` days later. The cycle that bills `after` ends on the first
 * sd-of-month ≥ `after.day` — if `after.day` is already past this month's
 * close, the bill has been generated and the transaction lands on the next
 * cycle's bill instead.
 *
 * Example: statementDate=13, gracePeriod=20
 *   after=Apr 28 → already past Apr 13 close, so cycle [Apr 14 — May 13]
 *                  closes May 13 → due Jun 2 ✓
 *   after=May 4  → still inside cycle [Apr 14 — May 13]   → due Jun 2 ✓
 *   after=May 13 → tx on close day bills on that day's cut → due Jun 2 ✓
 *   after=May 14 → already past May 13 close, next cycle  → due Jul 3 ✓
 */
export function nextStatementDueDate(
  after: Date,
  statementDate: number,
  gracePeriod: number,
): Date {
  const sd = Math.max(1, Math.min(31, statementDate));
  const grace = Math.max(0, gracePeriod);
  let y = after.getUTCFullYear();
  let m = after.getUTCMonth();
  const d = after.getUTCDate();
  // If `after` is past this month's close, the bill is already generated —
  // roll forward to next month so the transaction lands on the next cycle.
  const closeThisMonth = Math.min(sd, new Date(Date.UTC(y, m + 1, 0)).getUTCDate());
  if (d > closeThisMonth) {
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const close = new Date(Date.UTC(y, m, Math.min(sd, lastDay)));
  const due = new Date(close);
  due.setUTCDate(due.getUTCDate() + grace);
  return due;
}

/** Parse a period id from the URL search param into a {start, end} pair. */
export function parsePeriodId(id: string | null | undefined): { start: Date; end: Date } | null {
  if (!id) return null;
  const m = /^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/.exec(id);
  if (!m) return null;
  const start = new Date(`${m[1]}T00:00:00Z`);
  const end = new Date(`${m[2]}T00:00:00Z`);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
  return { start, end };
}

/**
 * Convert an inclusive {start, end} date pair into a Prisma `gte / lt` filter.
 * `lt` is set to start-of-next-day so the entire `end` day is included.
 */
export function rangeToPrismaFilter({ start, end }: { start: Date; end: Date }) {
  const nextDay = new Date(end.getTime() + 24 * 60 * 60 * 1000);
  return { gte: start, lt: nextDay };
}
