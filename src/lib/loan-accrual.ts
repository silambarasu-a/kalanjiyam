/**
 * Time-aware interest accrual for EMI loans.
 *
 * `loan-math.ts` answers "what does the contract say each cycle costs" — a
 * pure formula with no date input, so `outstanding × annualRate / cyclesPerYear`
 * is charged whether the payment lands a day or a year after the last one. On a
 * YEARLY gold loan that bills a full year of interest on a payment made a month
 * in. This module answers the other question a bank actually asks: "how much
 * interest has accrued between the last settled date and today."
 *
 * Broken-period interest, pro-rated over the cycle:
 *
 *   cycleDays = actual days from `from` to one cycle later
 *   fraction  = elapsedDays / cycleDays            (uncapped)
 *   interest  = outstanding · periodicRate · fraction
 *
 * Pro-rating the *cycle* rate rather than accruing raw actual/365 is what keeps
 * this backward compatible: an EMI paid on its due date has elapsed == cycleDays,
 * so `fraction` is exactly 1 and the split reproduces `splitPayment` to the
 * rupee. Only off-schedule payments move. For YEARLY frequency the two forms are
 * algebraically identical (periodicRate == annualRate/100, cycleDays == 365).
 *
 * `fraction` is deliberately uncapped: a payment made two cycles after the last
 * one owes two cycles of interest. Penal interest is a separate charge and is
 * not modelled here.
 *
 * Unlike `hand-loan-interest.ts` — whose header notes that nothing it returns is
 * ever persisted — the numbers here ARE persisted, as the principal/interest
 * split on a LoanLedgerEntry. Kept out of `loan-math.ts` so that module stays
 * free of ledger and date-resolution concerns.
 */

import {
  advanceByCycle,
  calculateEMI,
  monthsPerCycle,
  periodicRate,
  type LoanFrequency,
} from "@/lib/loan-math";

const round2 = (n: number) => Math.round(n * 100) / 100;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days between two dates, floored at 0. */
function daysBetween(from: Date, to: Date): number {
  return Math.max(0, (to.getTime() - from.getTime()) / DAY_MS);
}

export type AccrualLedgerEntry = {
  paidAt: Date;
  periodTo: Date | null;
  interestAmount: number;
};

/**
 * The date interest is settled up to — the `from` edge of the next accrual.
 *
 * 1. Latest entry that actually settled interest → its `periodTo` (what the
 *    user said the money covered) else its `paidAt`. Only interest-bearing
 *    entries move the mark; a pure principal prepayment settles no period.
 * 2. No such entry, but the loan has a `nextDueDate` → the start of the cycle
 *    that due date closes.
 * 3. Otherwise the loan's start.
 *
 * Rule 2 carries the load for existing data. A loan entered mid-life
 * (`isExisting`) has a `startedAt` years in the past and no ledger history, so
 * falling straight to rule 3 would accrue years of interest onto its first
 * payment. Anchoring at the current cycle's start is right for fresh and
 * mid-life loans alike. Payments recorded before the ledger existed still land
 * on rule 1 through the `paidAt` fallback, so no backfill is needed.
 */
export function accrualAnchor(args: {
  startedAt: Date;
  nextDueDate: Date | null;
  frequency: LoanFrequency;
  entries: AccrualLedgerEntry[];
}): Date {
  const settled = args.entries
    .filter((e) => e.interestAmount > 0)
    .sort((a, b) => b.paidAt.getTime() - a.paidAt.getTime())[0];
  if (settled) return settled.periodTo ?? settled.paidAt;

  if (args.nextDueDate) {
    const cycleStart = advanceByCycle(new Date(args.nextDueDate), args.frequency, -1);
    // Never earlier than the loan itself — a nextDueDate less than one cycle
    // after startedAt (hand-entered, or a statement-cycle first due) would
    // otherwise accrue interest for days before the money was borrowed.
    return cycleStart < args.startedAt ? args.startedAt : cycleStart;
  }
  return args.startedAt;
}

export type Accrual = {
  days: number;
  cycleDays: number;
  fraction: number;
  interest: number;
};

/**
 * Interest accrued on `outstanding` between `from` and `to`, pro-rated over the
 * cycle. `cycleDays` is measured from `from` rather than assumed, so February
 * and a 31-day month each get their own denominator.
 */
export function accrueCycleInterest(args: {
  outstanding: number;
  annualRate: number;
  frequency: LoanFrequency;
  from: Date;
  to: Date;
}): Accrual {
  const cycleDays = daysBetween(
    args.from,
    advanceByCycle(new Date(args.from), args.frequency, 1),
  );
  const days = daysBetween(args.from, args.to);
  // A degenerate cycleDays (identical dates) would divide by zero; treat the
  // period as fully elapsed, which is what the old formula-only split assumed.
  const fraction = cycleDays > 0 ? days / cycleDays : 1;
  const rate = periodicRate(args.annualRate ?? 0, args.frequency);
  const interest =
    args.outstanding > 0 && rate > 0
      ? round2(args.outstanding * rate * fraction)
      : 0;
  return { days, cycleDays, fraction, interest };
}

export type BankStyleSplit = Accrual & {
  interest: number;
  gst: number;
  principal: number;
  /** Interest left unpaid because the payment didn't cover the accrual. */
  shortfall: number;
  /** Paid over and above outstanding + interest + GST. */
  excess: number;
};

/**
 * Apply a payment the way a bank does: accrued interest first, GST on that
 * interest, whatever remains reduces principal.
 *
 * Underpaying leaves `principal` at 0 and reports the `shortfall` — the balance
 * does not fall, and the unpaid interest stays owed. Overpaying clamps
 * `principal` at `outstanding` and reports the `excess` so the caller can reject
 * it rather than silently absorb money the loan can't account for.
 */
export function applyPaymentBankStyle(args: {
  amount: number;
  outstanding: number;
  annualRate: number;
  frequency: LoanFrequency;
  gstOnInterestPct: number | null;
  from: Date;
  to: Date;
}): BankStyleSplit {
  const accrual = accrueCycleInterest({
    outstanding: args.outstanding,
    annualRate: args.annualRate,
    frequency: args.frequency,
    from: args.from,
    to: args.to,
  });
  const interest = accrual.interest;
  const gst =
    args.gstOnInterestPct && args.gstOnInterestPct > 0
      ? round2(interest * (args.gstOnInterestPct / 100))
      : 0;

  const towardsPrincipal = args.amount - interest - gst;
  const shortfall = towardsPrincipal < 0 ? round2(-towardsPrincipal) : 0;
  const principal = round2(
    Math.min(args.outstanding, Math.max(0, towardsPrincipal)),
  );
  const excess = round2(Math.max(0, towardsPrincipal - args.outstanding));

  return { ...accrual, interest, gst, principal, shortfall, excess };
}

/**
 * Payment cycles left between `asOf` and maturity, floored at 1 — a loan still
 * carrying a balance always has at least one payment to go.
 *
 * Derived from the calendar rather than by counting payments so it survives
 * prepayments, skipped cycles, and loans entered mid-life. Since a
 * part-prepayment keeps the tenure and recomputes the EMI, maturity is the
 * fixed point and this is the honest denominator.
 */
export function remainingCycles(
  asOf: Date,
  maturityAt: Date,
  frequency: LoanFrequency,
): number {
  const months =
    (maturityAt.getFullYear() - asOf.getFullYear()) * 12 +
    (maturityAt.getMonth() - asOf.getMonth()) +
    // Fractional month from the day-of-month offset, so a maturity 20 days out
    // rounds toward 1 cycle rather than 0.
    (maturityAt.getDate() - asOf.getDate()) / 30;
  return Math.max(1, Math.round(months / monthsPerCycle(frequency)));
}

/**
 * The EMI that clears `outstanding` by maturity with the tenure unchanged.
 * Returns null when the loan has no schedule to re-amortize (no rate, no
 * maturity, nothing left owing), so callers can leave `emiAmount` untouched.
 */
export function recalculatedEmi(args: {
  outstanding: number;
  annualRate: number;
  frequency: LoanFrequency;
  maturityAt: Date | null;
  asOf: Date;
}): number | null {
  if (args.outstanding <= 0) return null;
  if (!args.maturityAt) return null;
  if (!args.annualRate || args.annualRate <= 0) return null;
  const cycles = remainingCycles(args.asOf, args.maturityAt, args.frequency);
  const emi = calculateEMI(args.outstanding, args.annualRate, cycles, args.frequency);
  return emi > 0 ? emi : null;
}
