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
 * The next credit-card statement DUE DATE on or after `after`.
 *
 * Credit-card loans are repaid through the card's monthly statement: each
 * billing cycle closes on day `statementDate` and that bill is due
 * `gracePeriod` days later. Because of the grace window the statement that
 * MOST RECENTLY closed is usually still awaiting payment — its due date is
 * the loan's *next* due date, even though this month's statement hasn't
 * closed yet. So the answer is the earliest `close + gracePeriod` that is
 * not before `after`.
 *
 * Note this is NOT the due date of the statement that would bill a fresh
 * purchase made on `after` — that statement is a whole cycle later (it has
 * to close first). A loan's outstanding is already on the card, so its next
 * payment is the upcoming due date, in-grace closed statement included.
 *
 * Example: statementDate=13, gracePeriod=30
 *   after=Jul 2  → Jun 13 close is due Jul 13 (≥ Jul 2)        → Jul 13 ✓
 *                  (this month's Jul 13 close isn't due till Aug 12)
 *   after=Jul 20 → Jul 13 due already passed; Jul 13 close     → Aug 12 ✓
 *   after=Dec 29 → Dec 13 close is due Jan 12 (≥ Dec 29)       → Jan 12 ✓
 *
 * To advance to the due date one cycle LATER (e.g. after paying the current
 * bill, or when chaining a schedule), pass the current due date + 1 day.
 */
export function nextStatementDueDate(
  after: Date,
  statementDate: number,
  gracePeriod: number,
): Date {
  const sd = Math.max(1, Math.min(31, statementDate));
  const grace = Math.max(0, gracePeriod);
  const DAY = 24 * 60 * 60 * 1000;
  const anchor = Date.UTC(
    after.getUTCFullYear(),
    after.getUTCMonth(),
    after.getUTCDate(),
  );
  // Walk consecutive monthly closes, starting far enough back that any close
  // whose due date could still be ≥ anchor is covered (close ≥ anchor −
  // grace), and return the first due ≥ anchor.
  const y = after.getUTCFullYear();
  const monthsBack = Math.ceil(grace / 28) + 1;
  const iterations = monthsBack + 3;
  const firstMonth = after.getUTCMonth() - monthsBack;
  let lastDue = anchor;
  for (let i = 0; i < iterations; i++) {
    const m = firstMonth + i;
    const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const close = Date.UTC(y, m, Math.min(sd, lastDay));
    const due = close + grace * DAY;
    lastDue = due;
    if (due >= anchor) return new Date(due);
  }
  // Unreachable for realistic grace periods (the scan always overshoots the
  // anchor by ~3 months); return the last, largest due as a safe fallback.
  return new Date(lastDue);
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
