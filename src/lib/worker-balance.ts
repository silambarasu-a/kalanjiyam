import { prisma } from "@/lib/prisma";

/**
 * Pure-ish worker balance helper. Given a worker id + date window, returns the
 * canonical numbers every other feature reads.
 *
 * Rules:
 *   - Earnings = Σ attendance.rate × attendance.quantity (piece-rate) if both
 *     are set, else attendance.dailyRateOverride ?? worker.dailyRate for each
 *     present=true day.
 *   - paidFromWages = Σ wage_payment(non-bonus) − Σ live advance_repayment.
 *     Repayments net the wage outflow rather than adding to earnings, so a
 *     refunded advance returns the worker's "owed" balance to where it was.
 *   - balance = earnings − paidFromWages. Positive means owed to worker.
 *   - bonuses = Σ wage_payment.amount where isBonus. Tracked separately, never
 *     offsets the wage balance.
 *   - advances = Σ wage_payment.amount where isAdvance. Informational; already
 *     included in paidFromWages.
 *   - repaid = Σ live advance_repayment.amount. Already netted into
 *     paidFromWages; surfaced separately for UI.
 *   - Reversed repayments (reversedAt != null) are excluded from all sums.
 */
export type WorkerBalance = {
  workerId: string;
  earned: number;
  paidFromWages: number;
  balance: number;
  bonuses: number;
  advances: number;
  repaid: number;
  daysWorked: number;
};

export async function computeWorkerBalance(
  workerId: string,
  range?: { start?: Date; end?: Date }
): Promise<WorkerBalance> {
  const worker = await prisma.worker.findUnique({
    where: { id: workerId },
    select: { id: true, dailyRate: true },
  });
  if (!worker) throw new Error("Worker not found");
  const defaultRate = worker.dailyRate ? Number(worker.dailyRate) : 0;

  const dateFilter =
    range?.start || range?.end
      ? { date: { ...(range?.start ? { gte: range.start } : {}), ...(range?.end ? { lte: range.end } : {}) } }
      : {};
  const paidAtFilter =
    range?.start || range?.end
      ? { paidAt: { ...(range?.start ? { gte: range.start } : {}), ...(range?.end ? { lte: range.end } : {}) } }
      : {};
  const receivedAtFilter =
    range?.start || range?.end
      ? { receivedAt: { ...(range?.start ? { gte: range.start } : {}), ...(range?.end ? { lte: range.end } : {}) } }
      : {};

  const [attendance, payments, repayments] = await Promise.all([
    prisma.attendance.findMany({
      where: { workerId, present: true, ...dateFilter },
      select: { dailyRateOverride: true, quantity: true, rate: true },
    }),
    prisma.wagePayment.findMany({
      where: { workerId, ...paidAtFilter },
      select: { amount: true, isBonus: true, isAdvance: true },
    }),
    prisma.advanceRepayment.findMany({
      where: { workerId, reversedAt: null, ...receivedAtFilter },
      select: { amount: true },
    }),
  ]);

  const earned = attendance.reduce((sum, a) => {
    const rate = a.rate != null ? Number(a.rate) : null;
    const qty = a.quantity != null ? Number(a.quantity) : null;
    if (rate != null && qty != null) return sum + rate * qty;
    if (a.dailyRateOverride != null) return sum + Number(a.dailyRateOverride);
    return sum + defaultRate;
  }, 0);

  let paidGross = 0;
  let bonuses = 0;
  let advances = 0;
  for (const p of payments) {
    const amt = Number(p.amount);
    if (p.isBonus) {
      bonuses += amt;
    } else {
      paidGross += amt;
      if (p.isAdvance) advances += amt;
    }
  }
  const repaid = repayments.reduce((s, r) => s + Number(r.amount), 0);
  const paidFromWages = paidGross - repaid;

  return {
    workerId,
    earned: round2(earned),
    paidFromWages: round2(paidFromWages),
    balance: round2(earned - paidFromWages),
    bonuses: round2(bonuses),
    advances: round2(advances),
    repaid: round2(repaid),
    daysWorked: attendance.length,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
