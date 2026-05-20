import type {
  LivestockBatch,
  LivestockEvent,
  FeedLog,
  WeighingLog,
  MortalityLog,
  LivestockContract,
} from "@/generated/prisma/client";

/**
 * Domain math for a livestock batch — FCR, ADG, mortality %, and the
 * broiler-contract payout estimate. Lives in its own module so it can
 * be called from API routes, jobs, and (eventually) from the client
 * with the same inputs.
 *
 * Inputs are denormalised numbers/dates so callers can pull the Prisma
 * rows however they like. Outputs are plain `number`s (decimals
 * converted to Number()), already rounded to 3 dp where it matters.
 */

export type AnalyticsInputs = {
  batch: Pick<
    LivestockBatch,
    | "initialCount"
    | "currentCount"
    | "initialAvgWeight"
    | "targetWeight"
    | "targetFCR"
    | "startDate"
    | "endDate"
    | "expectedCycleDays"
    | "productionType"
  >;
  events: Pick<
    LivestockEvent,
    "eventType" | "count" | "avgWeightKg" | "totalWeightKg" | "date"
  >[];
  feedLogs: Pick<FeedLog, "quantity" | "amount" | "date">[];
  weighings: Pick<
    WeighingLog,
    "phase" | "avgKg" | "totalKg" | "sampleSize" | "date"
  >[];
  mortality: Pick<MortalityLog, "count" | "date">[];
  contract?: Pick<
    LivestockContract,
    | "agreedRatePerKg"
    | "fcrBonusBands"
    | "mortalityCap"
    | "mortalityPenalty"
  > | null;
};

export type AnalyticsOutput = {
  daysInCycle: number;
  // Live head count, computed from initialCount − deaths − sales + births + purchases.
  liveHead: number;
  // Cumulative kg of feed logged (sums only logs with a `quantity`).
  totalFeedKg: number;
  // Cumulative ₹ spent on feed (sums every log).
  totalFeedSpend: number;
  // Total live-weight gain in kg across the cycle so far.
  liveWeightGainKg: number;
  // Latest avg weight from the most recent weighing (kg/bird).
  latestAvgKg: number | null;
  // Feed-to-gain ratio = totalFeedKg / liveWeightGainKg. Lower is better.
  // Null if we don't yet have enough data to compute it.
  fcr: number | null;
  // Average daily weight gain in grams/bird.
  adgGrams: number | null;
  // Cumulative deaths.
  totalDeaths: number;
  // Mortality % vs initialCount.
  mortalityPct: number;
  // Boolean signals for "we don't have enough data yet" — UI uses these
  // to render dashes vs panicked red numbers.
  warnings: {
    missingFeedQuantity: boolean;
    missingArrivalWeight: boolean;
    noWeighings: boolean;
  };
  // Broiler-contract payout breakdown (null for non-contract batches).
  contractPayout: ContractPayout | null;
};

export type ContractPayout = {
  liftedWeightKg: number;
  basePayout: number;
  // Bonus per kg applied (may be 0 if FCR didn't hit any band).
  fcrBonusPerKg: number;
  fcrBonusAmount: number;
  // Penalty per kg applied (may be 0 if mortality stayed within cap).
  mortalityPenaltyPerKg: number;
  mortalityPenaltyAmount: number;
  expectedPayout: number;
};

type FcrBand = { maxFcr: number; bonusPerKg: number };
type MortalityBand = { overByPct: number; deductPerKg: number };

/** Coerces the Prisma Json column into typed bands, or [] on garbage. */
function asFcrBands(v: unknown): FcrBand[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (b): b is FcrBand =>
      typeof b === "object" &&
      b != null &&
      typeof (b as FcrBand).maxFcr === "number" &&
      typeof (b as FcrBand).bonusPerKg === "number",
  );
}
function asMortalityBands(v: unknown): MortalityBand[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (b): b is MortalityBand =>
      typeof b === "object" &&
      b != null &&
      typeof (b as MortalityBand).overByPct === "number" &&
      typeof (b as MortalityBand).deductPerKg === "number",
  );
}

function dec(v: { toString(): string } | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v.toString());
  return Number.isFinite(n) ? n : null;
}

export function computeBatchAnalytics({
  batch,
  events,
  feedLogs,
  weighings,
  mortality,
  contract,
}: AnalyticsInputs): AnalyticsOutput {
  // 1. Days in cycle — from startDate (or endDate if closed) to "now".
  const start = new Date(batch.startDate).getTime();
  const reference = batch.endDate
    ? new Date(batch.endDate).getTime()
    : Date.now();
  const daysInCycle = Math.max(
    0,
    Math.floor((reference - start) / (1000 * 60 * 60 * 24)),
  );

  // 2. Cumulative feed.
  let totalFeedKg = 0;
  let totalFeedSpend = 0;
  let missingFeedQuantity = false;
  for (const f of feedLogs) {
    totalFeedSpend += Number(f.amount.toString());
    if (f.quantity != null) {
      totalFeedKg += Number(f.quantity.toString());
    } else {
      missingFeedQuantity = true;
    }
  }

  // 3. Deaths + sales decrement live head; purchases/births increment it.
  // We use the explicit currentCount when present (it's authoritative)
  // and fall back to a replay for the head-count-over-time chart.
  const totalDeaths = mortality.reduce((sum, m) => sum + m.count, 0);
  const liveHead = batch.currentCount;
  const mortalityPct =
    batch.initialCount > 0 ? (totalDeaths / batch.initialCount) * 100 : 0;

  // 4. Weight gain — uses the latest weighing's avgKg vs the batch's
  // initialAvgWeight. If the user already entered an EXIT weighing,
  // factor that into a heavier "lifted weight" figure for the payout.
  const initialAvgKg = dec(batch.initialAvgWeight);
  const sortedWeighings = [...weighings].sort(
    (a, b) =>
      new Date(b.date).getTime() - new Date(a.date).getTime(),
  );
  const latestAvgKg =
    sortedWeighings.length > 0 ? Number(sortedWeighings[0].avgKg) : null;
  const exitWeighing = sortedWeighings.find((w) => w.phase === "EXIT") ?? null;
  const exitAvgKg = exitWeighing ? Number(exitWeighing.avgKg) : null;

  // SALE events also represent weight leaving the batch when their
  // avgWeightKg/totalWeightKg is set (lifted-weight basis).
  const liftedFromSales = events
    .filter((e) => e.eventType === "SALE")
    .reduce((sum, e) => {
      if (e.totalWeightKg != null) return sum + Number(e.totalWeightKg);
      if (e.avgWeightKg != null) return sum + Number(e.avgWeightKg) * e.count;
      return sum;
    }, 0);

  let liveWeightGainKg = 0;
  if (initialAvgKg != null && latestAvgKg != null) {
    // Current live birds × per-bird gain
    liveWeightGainKg += (latestAvgKg - initialAvgKg) * liveHead;
    // Plus what we've already sold
    liveWeightGainKg += liftedFromSales;
  } else if (latestAvgKg != null && initialAvgKg == null) {
    // No arrival weight — fall back to "current live × latest weight",
    // which over-estimates because it includes the chicks' birth weight.
    liveWeightGainKg += latestAvgKg * liveHead + liftedFromSales;
  }

  const fcr =
    liveWeightGainKg > 0 && totalFeedKg > 0
      ? +(totalFeedKg / liveWeightGainKg).toFixed(3)
      : null;

  const adgGrams =
    initialAvgKg != null && latestAvgKg != null && daysInCycle > 0
      ? +(((latestAvgKg - initialAvgKg) * 1000) / daysInCycle).toFixed(1)
      : null;

  // 5. Broiler-contract payout — only when a contract is linked.
  const contractPayout =
    contract && (exitAvgKg != null || latestAvgKg != null)
      ? computeContractPayout({
          contract,
          liftedWeightKg:
            liftedFromSales > 0
              ? liftedFromSales
              : (exitAvgKg ?? latestAvgKg ?? 0) * liveHead,
          fcr,
          mortalityPct,
        })
      : null;

  return {
    daysInCycle,
    liveHead,
    totalFeedKg,
    totalFeedSpend,
    liveWeightGainKg: +liveWeightGainKg.toFixed(3),
    latestAvgKg,
    fcr,
    adgGrams,
    totalDeaths,
    mortalityPct: +mortalityPct.toFixed(2),
    warnings: {
      missingFeedQuantity,
      missingArrivalWeight: initialAvgKg == null,
      noWeighings: weighings.length === 0,
    },
    contractPayout,
  };
}

function computeContractPayout({
  contract,
  liftedWeightKg,
  fcr,
  mortalityPct,
}: {
  contract: NonNullable<AnalyticsInputs["contract"]>;
  liftedWeightKg: number;
  fcr: number | null;
  mortalityPct: number;
}): ContractPayout {
  const rate = Number(contract.agreedRatePerKg.toString());
  const basePayout = +(liftedWeightKg * rate).toFixed(2);

  // FCR bonus — pick the LOWEST maxFcr band that the current FCR falls
  // under. Sort ascending so the tightest target wins first.
  const fcrBands = asFcrBands(contract.fcrBonusBands).sort(
    (a, b) => a.maxFcr - b.maxFcr,
  );
  let fcrBonusPerKg = 0;
  if (fcr != null) {
    const hit = fcrBands.find((b) => fcr <= b.maxFcr);
    if (hit) fcrBonusPerKg = hit.bonusPerKg;
  }
  const fcrBonusAmount = +(liftedWeightKg * fcrBonusPerKg).toFixed(2);

  // Mortality penalty — only fires above the cap. Bands describe how
  // much extra % over cap deducts how much per kg. We pick the HIGHEST
  // overByPct band that the current excess crosses.
  const cap =
    contract.mortalityCap == null
      ? null
      : Number(contract.mortalityCap.toString());
  const penaltyBands = asMortalityBands(contract.mortalityPenalty).sort(
    (a, b) => b.overByPct - a.overByPct,
  );
  let mortalityPenaltyPerKg = 0;
  if (cap != null && mortalityPct > cap) {
    const excess = mortalityPct - cap;
    const hit = penaltyBands.find((b) => excess >= b.overByPct);
    if (hit) mortalityPenaltyPerKg = hit.deductPerKg;
  }
  const mortalityPenaltyAmount = +(
    liftedWeightKg * mortalityPenaltyPerKg
  ).toFixed(2);

  const expectedPayout = +(
    basePayout +
    fcrBonusAmount -
    mortalityPenaltyAmount
  ).toFixed(2);

  return {
    liftedWeightKg: +liftedWeightKg.toFixed(3),
    basePayout,
    fcrBonusPerKg,
    fcrBonusAmount,
    mortalityPenaltyPerKg,
    mortalityPenaltyAmount,
    expectedPayout,
  };
}
