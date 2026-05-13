/**
 * Compute the next N due-dates for a recurring investment (SIP or insurance
 * premium) given a start date and frequency. Used to generate upcoming
 * reminders on investment create / update.
 */
export type PremiumFrequency =
  | "MONTHLY"
  | "QUARTERLY"
  | "HALF_YEARLY"
  | "YEARLY"
  | "ONE_TIME";

export function monthsForFrequency(f: PremiumFrequency): number | null {
  if (f === "MONTHLY") return 1;
  if (f === "QUARTERLY") return 3;
  if (f === "HALF_YEARLY") return 6;
  if (f === "YEARLY") return 12;
  return null; // ONE_TIME
}

export function computeReminderSchedule(args: {
  firstDueDate: Date;
  frequency: PremiumFrequency;
  count?: number; // default 12 occurrences
  until?: Date | null;
}): Date[] {
  const months = monthsForFrequency(args.frequency);
  const max = args.count ?? 12;
  const out: Date[] = [new Date(args.firstDueDate)];
  if (!months) return out;
  for (let i = 1; i < max; i++) {
    const next = addMonths(args.firstDueDate, months * i);
    if (args.until && next > args.until) break;
    out.push(next);
  }
  return out;
}

/**
 * Compute the right number of reminders to seed for a recurring
 * investment based on its term, with a hard cap.
 *
 * Priority:
 *   1. `premiumPayingTermYears` — limited-pay window (e.g. pay-for-10
 *      on a 20-year endowment). After this the user stops paying.
 *   2. `policyTermYears` — fallback when paying-term isn't set.
 *   3. `maturityAt` — date-based fallback if neither term is set.
 *   4. Default 24 cycles.
 *
 * Hard-capped at 600 so a misconfigured 999-year policy doesn't seed
 * an absurd number of rows.
 */
export function policyReminderCount(args: {
  frequency: PremiumFrequency;
  firstDueDate: Date;
  premiumPayingTermYears?: number | null;
  policyTermYears?: number | null;
  maturityAt?: Date | null;
}): number {
  const months = monthsForFrequency(args.frequency);
  if (!months) return 1;
  const HARD_CAP = 600;

  const termYears = args.premiumPayingTermYears ?? args.policyTermYears;
  if (termYears && termYears > 0) {
    return Math.min(HARD_CAP, Math.ceil((termYears * 12) / months));
  }
  if (args.maturityAt) {
    const ms = args.maturityAt.getTime() - args.firstDueDate.getTime();
    if (ms > 0) {
      const monthsToMaturity = ms / (1000 * 60 * 60 * 24 * 30.4375);
      return Math.min(HARD_CAP, Math.max(1, Math.ceil(monthsToMaturity / months)));
    }
  }
  return 24;
}

export function advanceDate(date: Date, frequency: PremiumFrequency): Date {
  const months = monthsForFrequency(frequency);
  if (!months) return date;
  return addMonths(date, months);
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + months);
  if (d.getUTCDate() < day) d.setUTCDate(0);
  return d;
}
