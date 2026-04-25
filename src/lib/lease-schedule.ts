/**
 * Compute the list of due-dates (and per-payment amount) for a lease spanning
 * [startDate, endDate] with the given frequency.
 *
 * - ONE_TIME: single payment due on startDate.
 * - YEARLY: one payment every 12 months, starting on startDate, as long as the
 *   anniversary falls within [startDate, endDate].
 * - CUSTOM_MONTHS: one payment every N months from startDate, while in range.
 *
 * The per-payment amount is the full lease `amount` divided by the number of
 * installments. If there is only one installment, it takes the full amount.
 */
export type LeaseFrequency = "ONE_TIME" | "YEARLY" | "CUSTOM_MONTHS";

export function computeLeaseSchedule(args: {
  startDate: Date;
  endDate: Date;
  frequency: LeaseFrequency;
  customMonths?: number | null;
  totalAmount: number;
}): { dueDate: Date; amount: number }[] {
  const { startDate, endDate, frequency, totalAmount } = args;
  if (endDate < startDate) return [];

  const dates: Date[] = [];
  if (frequency === "ONE_TIME") {
    dates.push(new Date(startDate));
  } else {
    const stepMonths = frequency === "YEARLY" ? 12 : (args.customMonths ?? 12);
    if (!stepMonths || stepMonths <= 0) return [];
    let cursor = new Date(startDate);
    while (cursor <= endDate) {
      dates.push(new Date(cursor));
      cursor = addMonths(cursor, stepMonths);
    }
  }

  if (dates.length === 0) return [];
  const per = Math.round((totalAmount / dates.length) * 100) / 100;
  // Distribute rounding to the first row so the total equals the lease amount.
  const first = totalAmount - per * (dates.length - 1);
  return dates.map((d, i) => ({
    dueDate: d,
    amount: i === 0 ? Math.round(first * 100) / 100 : per,
  }));
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + months);
  // If the target month has fewer days, setUTCMonth rolls over. Clamp back.
  if (d.getUTCDate() < day) d.setUTCDate(0);
  return d;
}
