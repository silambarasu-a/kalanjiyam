/**
 * Standard reducing-balance EMI math, matching how Indian banks compute
 * loan EMIs and per-payment splits.
 *
 * Tenure here is the number of *payment cycles* (not necessarily months).
 * Cycle length is set by `frequency`:
 *   MONTHLY      → 1 month / cycle, 12 cycles / year
 *   QUARTERLY    → 3 months / cycle, 4 cycles / year
 *   HALF_YEARLY  → 6 months / cycle, 2 cycles / year
 *   YEARLY       → 12 months / cycle, 1 cycle / year
 *
 * Formulas (per cycle):
 *   periodic rate r = annualRate / 100 / cyclesPerYear
 *   EMI = P · r · (1+r)^n / ((1+r)^n − 1)
 *   if r == 0  → EMI = P / n        (zero-interest case)
 *
 * Per-payment split (reducing balance):
 *   interest = outstanding · r
 *   principal = EMI − interest
 *   new outstanding = max(0, outstanding − principal)
 *
 * Card EMI with GST on interest (standard Indian bank statement style):
 *   GST is added on top of the interest component each cycle — it does
 *   not change the principal/interest split. Total per-cycle outflow =
 *   EMI + GST, where GST = interest · (gstOnInterest / 100).
 */

export type LoanFrequency = "MONTHLY" | "QUARTERLY" | "HALF_YEARLY" | "YEARLY";

const round2 = (n: number) => Math.round(n * 100) / 100;

export type AmortRow = {
  cycle: number;
  opening: number;
  interest: number;
  principal: number;
  gst: number;
  totalPaid: number;
  closing: number;
};

export function cyclesPerYear(frequency: LoanFrequency): number {
  switch (frequency) {
    case "MONTHLY":
      return 12;
    case "QUARTERLY":
      return 4;
    case "HALF_YEARLY":
      return 2;
    case "YEARLY":
      return 1;
  }
}

export function monthsPerCycle(frequency: LoanFrequency): number {
  return 12 / cyclesPerYear(frequency);
}

export function periodicRate(annualRate: number, frequency: LoanFrequency): number {
  return annualRate / 100 / cyclesPerYear(frequency);
}

/**
 * Standard reducing-balance EMI for the given cycle count + frequency.
 * Returns 0 when inputs are invalid so the caller can hide the preview
 * without exception handling.
 */
export function calculateEMI(
  principal: number,
  annualRate: number,
  tenureCycles: number,
  frequency: LoanFrequency = "MONTHLY"
): number {
  if (!Number.isFinite(principal) || principal <= 0) return 0;
  if (!Number.isFinite(tenureCycles) || tenureCycles <= 0) return 0;
  if (!Number.isFinite(annualRate) || annualRate < 0) return 0;
  if (annualRate === 0) return round2(principal / tenureCycles);
  const r = periodicRate(annualRate, frequency);
  const pow = Math.pow(1 + r, tenureCycles);
  return round2((principal * r * pow) / (pow - 1));
}

/**
 * Split a single EMI payment into interest + principal + (optional) GST
 * for one cycle of the chosen frequency. Used to suggest a default split
 * on the pay dialog and to seed the amortization schedule.
 */
export function splitPayment(
  outstanding: number,
  annualRate: number,
  emi: number,
  frequency: LoanFrequency = "MONTHLY",
  gstOnInterestPct: number | null = null
): { interest: number; principal: number; gst: number } {
  if (outstanding <= 0 || emi <= 0) {
    return { interest: 0, principal: 0, gst: 0 };
  }
  const r = periodicRate(annualRate ?? 0, frequency);
  const interestRaw = Math.max(0, outstanding * r);
  // Last EMI may be smaller than the formula EMI because of rounding —
  // clamp to the outstanding so principal never exceeds what's owed.
  const principalRaw = Math.min(outstanding, Math.max(0, emi - interestRaw));
  const interest = round2(interestRaw);
  const principal = round2(principalRaw);
  const gst =
    gstOnInterestPct && gstOnInterestPct > 0
      ? round2(interest * (gstOnInterestPct / 100))
      : 0;
  return { interest, principal, gst };
}

/**
 * Full cycle-by-cycle amortization. Caller can pass `gstOnInterestPct`
 * for card-EMI plans where each statement adds GST on the interest
 * portion.
 */
export function amortizationSchedule(
  principal: number,
  annualRate: number,
  tenureCycles: number,
  frequency: LoanFrequency = "MONTHLY",
  gstOnInterestPct: number | null = null
): AmortRow[] {
  if (principal <= 0 || tenureCycles <= 0) return [];
  const emi = calculateEMI(principal, annualRate, tenureCycles, frequency);
  if (emi <= 0) return [];

  const rows: AmortRow[] = [];
  let balance = principal;
  for (let c = 1; c <= tenureCycles; c++) {
    const split = splitPayment(balance, annualRate, emi, frequency, gstOnInterestPct);
    // Last cycle: absorb residual into principal so balance lands at 0.
    const principalPart = c === tenureCycles ? round2(balance) : split.principal;
    const opening = round2(balance);
    const closing = round2(Math.max(0, balance - principalPart));
    rows.push({
      cycle: c,
      opening,
      interest: split.interest,
      principal: principalPart,
      gst: split.gst,
      totalPaid: round2(principalPart + split.interest + split.gst),
      closing,
    });
    balance = closing;
    if (balance <= 0) break;
  }
  return rows;
}

/**
 * Headline numbers for the form preview: total interest, total GST, and
 * the total amount payable (sum of all per-cycle outflows).
 */
export function loanTotals(
  principal: number,
  annualRate: number,
  tenureCycles: number,
  frequency: LoanFrequency = "MONTHLY",
  gstOnInterestPct: number | null = null
): {
  emi: number;
  totalInterest: number;
  totalGst: number;
  totalPayable: number;
} {
  const schedule = amortizationSchedule(
    principal,
    annualRate,
    tenureCycles,
    frequency,
    gstOnInterestPct
  );
  const totalInterest = round2(schedule.reduce((s, r) => s + r.interest, 0));
  const totalGst = round2(schedule.reduce((s, r) => s + r.gst, 0));
  const emi = calculateEMI(principal, annualRate, tenureCycles, frequency);
  const totalPayable = round2(principal + totalInterest + totalGst);
  return { emi, totalInterest, totalGst, totalPayable };
}

/**
 * Walk the schedule and count how many EMI cycles the current
 * outstanding has already amortized — used to skip past-paid rows for
 * loans flagged `isExisting`.
 */
export function countPaidEmis(
  principal: number,
  annualRate: number,
  emi: number,
  tenureCycles: number,
  frequency: LoanFrequency,
  outstanding: number
): number {
  if (tenureCycles <= 0 || emi <= 0 || outstanding >= principal) return 0;
  const r = periodicRate(annualRate, frequency);
  let balance = principal;
  let paid = 0;
  for (let i = 1; i <= tenureCycles; i++) {
    const interest = balance * r;
    balance = Math.max(0, balance - (emi - interest));
    if (balance < outstanding - 0.01) break;
    paid = i;
  }
  return paid;
}

/** Advance a date by one EMI cycle for the given frequency. */
export function advanceByCycle(date: Date, frequency: LoanFrequency, cycles = 1): Date {
  const next = new Date(date);
  const m = monthsPerCycle(frequency) * cycles;
  next.setMonth(next.getMonth() + m);
  return next;
}
