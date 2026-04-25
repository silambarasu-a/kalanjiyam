/**
 * Standard reducing-balance EMI math, matching how Indian banks compute
 * loan EMIs and per-payment splits.
 *
 * Formulas:
 *   monthly rate r = annualRate / 100 / 12
 *   EMI = P · r · (1+r)^n / ((1+r)^n − 1)
 *   if r == 0  → EMI = P / n        (zero-interest case)
 *
 * Per-payment split (reducing balance):
 *   interest = outstanding · r
 *   principal = EMI − interest
 *   new outstanding = max(0, outstanding − principal)
 *
 * Card EMI with GST on interest (standard Indian bank statement style):
 *   GST is added on top of the interest component each month — it does not
 *   change the principal/interest split. Total monthly outflow = EMI + GST,
 *   where GST = interest · (gstOnInterest / 100).
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

export type AmortRow = {
  month: number;
  opening: number;
  interest: number;
  principal: number;
  gst: number;
  totalPaid: number;
  closing: number;
};

export function monthlyRate(annualRate: number): number {
  return annualRate / 100 / 12;
}

/**
 * Standard reducing-balance EMI. Returns 0 when inputs are invalid so the
 * caller can hide the preview without exception handling.
 */
export function calculateEMI(
  principal: number,
  annualRate: number,
  tenureMonths: number
): number {
  if (!Number.isFinite(principal) || principal <= 0) return 0;
  if (!Number.isFinite(tenureMonths) || tenureMonths <= 0) return 0;
  if (!Number.isFinite(annualRate) || annualRate < 0) return 0;
  if (annualRate === 0) return round2(principal / tenureMonths);
  const r = monthlyRate(annualRate);
  const pow = Math.pow(1 + r, tenureMonths);
  return round2((principal * r * pow) / (pow - 1));
}

/**
 * Split a single EMI payment into interest + principal + (optional) GST.
 * Used to suggest a default split on the pay dialog and to seed the
 * amortization schedule.
 */
export function splitPayment(
  outstanding: number,
  annualRate: number,
  emi: number,
  gstOnInterestPct: number | null = null
): { interest: number; principal: number; gst: number } {
  if (outstanding <= 0 || emi <= 0) {
    return { interest: 0, principal: 0, gst: 0 };
  }
  const r = monthlyRate(annualRate ?? 0);
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
 * Full month-by-month amortization. Caller can pass `gstOnInterestPct` for
 * card-EMI plans where each statement adds GST on the interest portion.
 */
export function amortizationSchedule(
  principal: number,
  annualRate: number,
  tenureMonths: number,
  gstOnInterestPct: number | null = null
): AmortRow[] {
  if (principal <= 0 || tenureMonths <= 0) return [];
  const emi = calculateEMI(principal, annualRate, tenureMonths);
  if (emi <= 0) return [];

  const rows: AmortRow[] = [];
  let balance = principal;
  for (let m = 1; m <= tenureMonths; m++) {
    const split = splitPayment(balance, annualRate, emi, gstOnInterestPct);
    // Last month: absorb residual into principal so balance lands at 0.
    const principalPart = m === tenureMonths ? round2(balance) : split.principal;
    const opening = round2(balance);
    const closing = round2(Math.max(0, balance - principalPart));
    rows.push({
      month: m,
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
 * the total amount payable (sum of all monthly outflows).
 */
export function loanTotals(
  principal: number,
  annualRate: number,
  tenureMonths: number,
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
    tenureMonths,
    gstOnInterestPct
  );
  const totalInterest = round2(schedule.reduce((s, r) => s + r.interest, 0));
  const totalGst = round2(schedule.reduce((s, r) => s + r.gst, 0));
  const emi = calculateEMI(principal, annualRate, tenureMonths);
  const totalPayable = round2(principal + totalInterest + totalGst);
  return { emi, totalInterest, totalGst, totalPayable };
}

/**
 * Walk the schedule and count how many EMIs the current outstanding has
 * already amortized — used to skip past-paid rows for loans flagged
 * `isExisting`.
 */
export function countPaidEmis(
  principal: number,
  annualRate: number,
  emi: number,
  tenureMonths: number,
  outstanding: number
): number {
  if (tenureMonths <= 0 || emi <= 0 || outstanding >= principal) return 0;
  const r = monthlyRate(annualRate);
  let balance = principal;
  let paid = 0;
  for (let i = 1; i <= tenureMonths; i++) {
    const interest = balance * r;
    balance = Math.max(0, balance - (emi - interest));
    if (balance < outstanding - 0.01) break;
    paid = i;
  }
  return paid;
}
