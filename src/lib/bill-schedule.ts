import type { UtilityBillCycle, UtilityKind } from "@/generated/prisma/client";

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

/**
 * Due date for a generated bill. Prefer the provider's `defaultDueDay`
 * (next occurrence on/after the bill date); otherwise bill date +
 * `fallbackDays`.
 */
export function computeDueDate(
  billDate: Date,
  defaultDueDay: number | null | undefined,
  fallbackDays = 15,
): Date {
  const b = atUtcMidnight(billDate);
  if (defaultDueDay == null) {
    const d = new Date(b);
    d.setUTCDate(d.getUTCDate() + fallbackDays);
    return d;
  }
  const sameMonth = dayInMonth(
    b.getUTCFullYear(),
    b.getUTCMonth(),
    defaultDueDay,
  );
  if (sameMonth >= b) return sameMonth;
  return dayInMonth(b.getUTCFullYear(), b.getUTCMonth() + 1, defaultDueDay);
}

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * Human billing-period label for a bill, e.g.
 *   MONTHLY     → "Jun 2026"
 *   BIMONTHLY   → "Jun–Jul 2026"
 *   QUARTERLY   → "Jul–Sep 2026"
 *   HALF_YEARLY → "Jul–Dec 2026"
 *   YEARLY      → "2026"
 * Used in transaction descriptions so the ledger reads properly.
 */
export function billPeriodLabel(billDate: Date, cycle: UtilityBillCycle): string {
  const b = atUtcMidnight(billDate);
  const months = cycleMonths(cycle);
  const y = b.getUTCFullYear();
  if (cycle === "YEARLY") return String(y);
  if (months === 1) return `${MONTHS_SHORT[b.getUTCMonth()]} ${y}`;
  const end = addMonths(b, months - 1);
  const startLabel = MONTHS_SHORT[b.getUTCMonth()];
  const endLabel = MONTHS_SHORT[end.getUTCMonth()];
  // Show the trailing year; add the leading year only when the window
  // straddles a year boundary (e.g. "Dec 2026–Jan 2027").
  return end.getUTCFullYear() === y
    ? `${startLabel}–${endLabel} ${y}`
    : `${startLabel} ${y}–${endLabel} ${end.getUTCFullYear()}`;
}

/**
 * Proper, self-describing transaction description for a bill payment:
 *   "TNEB — Jun 2026 · Conn 1234567"   (autopay adds "· auto-pay")
 * The provider name usually already carries the utility (TNEB, ACT), so
 * we don't repeat the kind; the period + connection make it unambiguous
 * in the ledger.
 */
export function billDescription(args: {
  providerName: string;
  connectionNumber?: string | null;
  billDate: Date;
  cycle: UtilityBillCycle;
  autopay?: boolean;
}): string {
  const period = billPeriodLabel(args.billDate, args.cycle);
  const parts = [`${args.providerName} — ${period} bill`];
  if (args.connectionNumber) parts.push(`Conn ${args.connectionNumber}`);
  if (args.autopay) parts.push("auto-pay");
  return parts.join(" · ");
}

/** Optional short kind label, kept for callers that want it in the UI. */
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
