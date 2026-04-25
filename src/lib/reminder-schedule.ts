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
