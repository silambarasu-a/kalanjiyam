import type {
  SubscriptionCycle,
  UtilityBillCycle,
  UtilityKind,
} from "@/generated/prisma/client";

/**
 * Recurring-utility date math. Everything works in UTC to match the
 * `@db.Date` columns (Prisma returns those as UTC-midnight Dates) and the
 * rest of the codebase's `setUTC*` convention. Mirrors the subscription
 * `advanceCycle` helper in cascades.ts but for the utility bill cycles.
 */

const CYCLE_MONTHS: Record<UtilityBillCycle, number> = {
  MONTHLY: 1,
  BIMONTHLY: 2,
  QUARTERLY: 3,
  HALF_YEARLY: 6,
  YEARLY: 12,
};

export function cycleMonths(cycle: UtilityBillCycle): number {
  return CYCLE_MONTHS[cycle] ?? 1;
}

/** Add `months`, clamping to month-end when the target month is shorter. */
function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + months);
  // e.g. Jan 31 + 1mo → Feb 31 rolls to Mar; clamp back to Feb 28/29.
  if (d.getUTCDate() < day) d.setUTCDate(0);
  return d;
}

/** Advance a bill date forward by one billing cycle. */
export function advanceBillCycle(date: Date, cycle: UtilityBillCycle): Date {
  return addMonths(date, cycleMonths(cycle));
}

/** Normalise to UTC midnight. */
function atUtcMidnight(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** Add `days` to a date, normalising to UTC midnight. */
export function addDaysUtc(date: Date, days: number): Date {
  const d = atUtcMidnight(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/**
 * New validity expiry for a prepaid recharge. When `extendFromCurrent`
 * and the current validity is still live (ends after the recharge date),
 * the fresh days STACK onto the remaining validity; otherwise they start
 * from the recharge date. Mirrors how prepaid ISPs/telcos (JioAirFiber,
 * Jio mobile) add days when you recharge before expiry.
 */
export function computeRechargeExpiry(opts: {
  paidOn: Date;
  validityDays: number;
  currentValidUntil?: Date | null;
  extendFromCurrent?: boolean;
}): Date {
  const paid = atUtcMidnight(opts.paidOn);
  const current = opts.currentValidUntil
    ? atUtcMidnight(opts.currentValidUntil)
    : null;
  const base =
    opts.extendFromCurrent && current && current > paid ? current : paid;
  return addDaysUtc(base, opts.validityDays);
}

/** Clamp a 1–31 day-of-month onto the given year/month (handles Feb, etc.). */
function dayInMonth(year: number, month: number, day: number): Date {
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const clamped = Math.min(Math.max(day, 1), daysInMonth);
  return new Date(Date.UTC(year, month, clamped));
}

/**
 * First bill date on/after `from` that lands on `billingDay`. Used when a
 * provider first switches to recurring — we never back-date bills, so the
 * first generated bill is the next occurrence of the billing day.
 */
export function initialNextBillDate(from: Date, billingDay: number): Date {
  const f = atUtcMidnight(from);
  const candidate = dayInMonth(f.getUTCFullYear(), f.getUTCMonth(), billingDay);
  if (candidate >= f) return candidate;
  return dayInMonth(f.getUTCFullYear(), f.getUTCMonth() + 1, billingDay);
}

const DEFAULT_GRACE_DAYS = 15;

/**
 * Due date for a bill given the provider's due-date basis:
 *   - `gracePeriodDays` set → N days AFTER the statement (grace-period
 *     bills, e.g. "due 15 days from the bill date"). Takes precedence.
 *   - else `defaultDueDay` set → the next occurrence of that day-of-month
 *     on/after the statement (fixed-due-day bills).
 *   - else → a DEFAULT_GRACE_DAYS-day fallback.
 */
export function computeDueDate(
  billDate: Date,
  opts: {
    defaultDueDay?: number | null;
    gracePeriodDays?: number | null;
  },
): Date {
  const b = atUtcMidnight(billDate);
  if (opts.gracePeriodDays != null) {
    const d = new Date(b);
    d.setUTCDate(d.getUTCDate() + opts.gracePeriodDays);
    return d;
  }
  if (opts.defaultDueDay == null) {
    const d = new Date(b);
    d.setUTCDate(d.getUTCDate() + DEFAULT_GRACE_DAYS);
    return d;
  }
  const sameMonth = dayInMonth(
    b.getUTCFullYear(),
    b.getUTCMonth(),
    opts.defaultDueDay,
  );
  if (sameMonth >= b) return sameMonth;
  return dayInMonth(b.getUTCFullYear(), b.getUTCMonth() + 1, opts.defaultDueDay);
}

const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Format a date as "04 May 2026" (UTC, day-first, full month). */
export function formatBillDate(d: Date): string {
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${day} ${MONTHS_LONG[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export type BillPeriod = { from: Date; to: Date };

/** A recorded service window, as it arrives from Prisma or from JSON. */
export type StoredBillPeriod = {
  periodFrom?: Date | string | null;
  periodTo?: Date | string | null;
};

function toDateOrNull(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return atUtcMidnight(d);
}

/**
 * The service window a postpaid bill covers, DERIVED from the provider's
 * nominal cycle. Utilities are billed in arrears: the statement date
 * (billDate) is issued just AFTER the service window closes, and the
 * payment due date falls LATER still. So the period is the cycle ENDING
 * the day before the statement, NOT the cycle starting on it — otherwise
 * the due date would land before the period ends, which is impossible.
 *
 *   statement 04 Jun 2026 (MONTHLY) → covers 04 May 2026 → 03 Jun 2026,
 *   due e.g. 20 Jun 2026.
 *
 * This is only ever a GUESS — see `billPeriodRange`, which prefers the
 * window actually printed on the bill when the user recorded it.
 */
export function derivedBillPeriod(
  billDate: Date,
  cycle: UtilityBillCycle,
): BillPeriod {
  const stmt = atUtcMidnight(billDate);
  const to = new Date(stmt);
  to.setUTCDate(to.getUTCDate() - 1); // day before the statement
  const from = addMonths(stmt, -cycleMonths(cycle)); // one cycle earlier
  return { from, to };
}

/**
 * The service window a bill covers — the bill's OWN recorded period when
 * it has one, otherwise the cycle-derived guess.
 *
 * Real cadences drift (a nominally bimonthly EB connection can issue a
 * one-month bill), so deriving the window from the cycle alone mislabels
 * those bills and, worse, bakes the wrong span into the ledger
 * description at pay time. Both endpoints must be present and ordered
 * for the stored window to win; a half-recorded window falls back rather
 * than inventing an endpoint.
 */
export function billPeriodRange(
  billDate: Date,
  cycle: UtilityBillCycle,
  stored?: StoredBillPeriod | null,
): BillPeriod {
  const from = toDateOrNull(stored?.periodFrom);
  const to = toDateOrNull(stored?.periodTo);
  if (from && to && to >= from) return { from, to };
  return derivedBillPeriod(billDate, cycle);
}

/** Whether a bill carries a usable recorded period (vs a derived guess). */
export function hasStoredPeriod(stored?: StoredBillPeriod | null): boolean {
  const from = toDateOrNull(stored?.periodFrom);
  const to = toDateOrNull(stored?.periodTo);
  return !!(from && to && to >= from);
}

/**
 * Inclusive length of a service window in days — a window whose ends are
 * the same day counts as 1. This is the denominator that makes bills of
 * unequal length comparable: ₹/day and units/day are meaningful across a
 * 31-day and a 62-day bill where raw totals are not.
 */
export function periodDays(from: Date, to: Date): number {
  const a = atUtcMidnight(from).getTime();
  const b = atUtcMidnight(to).getTime();
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}

/**
 * Proper, self-describing transaction description for a bill payment.
 * The period is the service window billed in arrears (see billPeriodRange):
 *   statement 04 Jun 2026 → "Internet: BSNL bill from 04 May 2026 to 03 June 2026"
 * The kind prefix + provider + billing period make the ledger entry
 * unambiguous at a glance. Pass the bill's recorded period so the
 * description states the span the user was actually billed for.
 */
export function billDescription(args: {
  kind: UtilityKind;
  providerName: string;
  billDate: Date;
  cycle: UtilityBillCycle;
  period?: StoredBillPeriod | null;
}): string {
  const { from, to } = billPeriodRange(args.billDate, args.cycle, args.period);
  return `${utilityKindLabel(args.kind)}: ${args.providerName} bill from ${formatBillDate(
    from,
  )} to ${formatBillDate(to)}`;
}

const SUB_CYCLE_MONTHS: Record<
  Exclude<SubscriptionCycle, "WEEKLY">,
  number
> = { MONTHLY: 1, QUARTERLY: 3, HALF_YEARLY: 6, YEARLY: 12 };

/** End of the service window for a subscription cycle starting at `start`. */
function subscriptionPeriodEnd(start: Date, cycle: SubscriptionCycle): Date {
  const from = atUtcMidnight(start);
  if (cycle === "WEEKLY") {
    const d = new Date(from);
    d.setUTCDate(d.getUTCDate() + 6);
    return d;
  }
  const end = addMonths(from, SUB_CYCLE_MONTHS[cycle]);
  end.setUTCDate(end.getUTCDate() - 1);
  return end;
}

/**
 * Description for a subscription payment, mirroring the bill format:
 *   "Netflix from 12 July 2026 to 11 August 2026"
 */
export function subscriptionDescription(
  name: string,
  periodStart: Date,
  cycle: SubscriptionCycle,
): string {
  const from = atUtcMidnight(periodStart);
  const to = subscriptionPeriodEnd(from, cycle);
  return `${name} from ${formatBillDate(from)} to ${formatBillDate(to)}`;
}

/** Optional short kind label, used as the description prefix + in the UI. */
export function utilityKindLabel(kind: UtilityKind): string {
  return (
    {
      ELECTRICITY: "Electricity",
      INTERNET: "Internet",
      MOBILE_POSTPAID: "Mobile (postpaid)",
      MOBILE_PREPAID: "Mobile (prepaid)",
      DTH: "DTH / Cable",
      GAS: "Gas",
      WATER: "Water",
      OTHER: "Utility",
    } as const
  )[kind];
}
