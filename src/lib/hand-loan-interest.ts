/**
 * Interest math for AD_HOC hand loans, where the settled amount is whatever
 * actually changes hands on the day and only the *cadence* is agreed.
 *
 * Nothing here is amortization. Every function returns a hint the UI labels as
 * an estimate; no value produced here is ever persisted or auto-posted. The
 * recorded truth lives in LoanLedgerEntry.
 *
 * Kept out of loan-math.ts on purpose — that module is reducing-balance EMI
 * math whose `cyclesPerYear` switch has no default, so a BIMONTHLY or
 * AT_MATURITY cadence must never reach it.
 */

export type LoanInterestCadence =
  | "MONTHLY"
  | "BIMONTHLY"
  | "QUARTERLY"
  | "HALF_YEARLY"
  | "YEARLY"
  | "AT_MATURITY";

const round2 = (n: number) => Math.round(n * 100) / 100;

const DAY_MS = 24 * 60 * 60 * 1000;

// Matches CYCLE_MONTHS in bill-schedule.ts for the shared spellings.
const CADENCE_MONTHS: Record<
  Exclude<LoanInterestCadence, "AT_MATURITY">,
  number
> = {
  MONTHLY: 1,
  BIMONTHLY: 2,
  QUARTERLY: 3,
  HALF_YEARLY: 6,
  YEARLY: 12,
};

/** Single source of truth for the cadence dropdown, so labels stay in sync. */
export const INTEREST_CADENCE_OPTIONS: {
  value: LoanInterestCadence;
  label: string;
}[] = [
  { value: "MONTHLY", label: "Monthly" },
  { value: "BIMONTHLY", label: "Every 2 months" },
  { value: "QUARTERLY", label: "Quarterly" },
  { value: "HALF_YEARLY", label: "Half-yearly" },
  { value: "YEARLY", label: "Yearly" },
  { value: "AT_MATURITY", label: "At end of tenure" },
];

export function formatInterestCadence(
  cadence: string | null | undefined,
): string {
  if (!cadence) return "—";
  return (
    INTEREST_CADENCE_OPTIONS.find((o) => o.value === cadence)?.label ??
    cadence.toLowerCase().replace(/_/g, " ")
  );
}

/** Months between settlements; null for AT_MATURITY (one settlement, at the end). */
export function cadenceMonths(
  cadence: LoanInterestCadence | string | null | undefined,
): number | null {
  if (!cadence || cadence === "AT_MATURITY") return null;
  return CADENCE_MONTHS[cadence as keyof typeof CADENCE_MONTHS] ?? null;
}

/**
 * Next settlement date.
 *
 * AT_MATURITY resolves to the maturity date. No cadence at all → null, and the
 * loan simply never shows up as due (correct for interest-free lending).
 */
export function nextInterestDueDate(
  from: Date,
  cadence: LoanInterestCadence | string | null | undefined,
  maturityAt: Date | null,
): Date | null {
  if (!cadence) return null;
  if (cadence === "AT_MATURITY") return maturityAt ?? null;
  const months = cadenceMonths(cadence);
  if (months == null) return null;
  const next = new Date(from);
  next.setMonth(next.getMonth() + months);
  return next;
}

export type PrincipalSegment = { from: Date; to: Date; principal: number };

/**
 * Simple interest over a time-weighted principal:
 *
 *   interest = Σ  principal_i · (annualRate/100) · days_i / 365
 *
 * Segmented rather than `rate × current outstanding × elapsed` so a partial
 * principal repayment mid-period accrues at the higher balance up to the
 * repayment date and the lower balance after it. The unsegmented form
 * under-charges the borrower for exactly the period they still owed more.
 */
export function accrueSimpleInterest(
  segments: PrincipalSegment[],
  annualRate: number,
): number {
  if (!annualRate || annualRate <= 0) return 0;
  let total = 0;
  for (const s of segments) {
    const days = (s.to.getTime() - s.from.getTime()) / DAY_MS;
    if (days <= 0 || s.principal <= 0) continue;
    total += s.principal * (annualRate / 100) * (days / 365);
  }
  return round2(total);
}

/**
 * Build the segments from ledger entries by walking BACKWARD from the
 * authoritative Loan.outstanding, adding each entry's principalAmount back as
 * we move into the past.
 *
 * Never derived forward from Loan.principal: a loan entered mid-life with
 * `isExisting = true` has no DISBURSEMENT entry, so a forward walk would start
 * from the wrong anchor and over-state every balance.
 */
export function principalSegments(args: {
  outstanding: number;
  entries: Array<{ paidAt: Date; principalAmount: number }>;
  since: Date;
  until: Date;
}): PrincipalSegment[] {
  const { outstanding, since, until } = args;
  // Newest first, so each step back in time undoes one principal reduction.
  const entries = [...args.entries]
    .filter((e) => e.paidAt <= until)
    .sort((a, b) => b.paidAt.getTime() - a.paidAt.getTime());

  const segments: PrincipalSegment[] = [];
  let balance = outstanding;
  let boundary = until;

  for (const e of entries) {
    if (e.paidAt <= since) break;
    if (e.paidAt < boundary) {
      segments.push({ from: e.paidAt, to: boundary, principal: balance });
      boundary = e.paidAt;
    }
    balance += e.principalAmount;
  }
  if (boundary > since) {
    segments.push({ from: since, to: boundary, principal: balance });
  }
  return segments.reverse();
}

/**
 * "Interest you'd expect by now" — accrual since the last covered date.
 *
 * The anchor is the latest entry's `periodTo` when the user recorded one (they
 * told us what the money covered), else its `paidAt`, else the loan's start.
 *
 * Returns null when the loan charges no interest, so the UI can render "—"
 * rather than a ₹0 that reads as "nothing is owed".
 */
export function interestExpectedSince(args: {
  startedAt: Date;
  annualRate: number | null;
  outstanding: number;
  entries: Array<{
    paidAt: Date;
    principalAmount: number;
    periodTo: Date | null;
    interestAmount: number;
  }>;
  asOf: Date;
}): { anchor: Date; expected: number } | null {
  const rate = args.annualRate ?? 0;
  if (rate <= 0) return null;

  // Only entries that actually settled interest move the "covered up to" mark.
  const interestEntries = args.entries
    .filter((e) => e.interestAmount > 0)
    .sort((a, b) => b.paidAt.getTime() - a.paidAt.getTime());
  const latest = interestEntries[0];
  const anchor = latest
    ? (latest.periodTo ?? latest.paidAt)
    : args.startedAt;
  if (anchor >= args.asOf) return { anchor, expected: 0 };

  const segments = principalSegments({
    outstanding: args.outstanding,
    entries: args.entries,
    since: anchor,
    until: args.asOf,
  });
  return { anchor, expected: accrueSimpleInterest(segments, rate) };
}
