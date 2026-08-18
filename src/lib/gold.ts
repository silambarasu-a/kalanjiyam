/**
 * Gold arithmetic, shared verbatim by the browser form and the API
 * routes. Nothing here touches Prisma, React, or the DOM — that is the
 * whole point: the server recomputes every ornament line with the same
 * code the user watched produce the number, so "the server disagrees
 * with my bill" can only mean the client sent something it didn't show.
 *
 * An Indian gold bill itemises wastage, making and GST PER LINE, so all
 * of this operates on one ornament. There is no bill-level pro-rating
 * anywhere in the system.
 */

export type ChargeMode = "RUPEE" | "PERCENT";

/** 1 carat = 0.2 grams. The bill quotes stones in carats. */
export const CARAT_TO_GRAM = 0.2;

export type GoldStoneInput = {
  /** Free-form label — "Diamond", "Ruby", "Kundan". */
  kind?: string | null;
  /** Stone weight in grams. Deducted from gross to get net gold. */
  weight: number;
  /** Carats — the bill's natural unit. */
  carats?: number | null;
  /** Rate per carat in ₹. */
  ratePerCt?: number | null;
  /** ₹ line for this stone. Sits inside the GST base. */
  charge: number;
};

export type OrnamentLineInput = {
  grossWeightGrams: number;
  ratePerGram: number;
  stones?: GoldStoneInput[] | null;
  wastageInput?: string | number | null;
  wastageMode?: ChargeMode | null;
  makingInput?: string | number | null;
  makingMode?: ChargeMode | null;
  cgstInput?: string | number | null;
  cgstMode?: ChargeMode | null;
  sgstInput?: string | number | null;
  sgstMode?: ChargeMode | null;
  roundOff?: number | null;
};

export type OrnamentLine = {
  stoneWeightGrams: number;
  netWeightGrams: number;
  goldValue: number;
  wastageAmount: number;
  makingAmount: number;
  stoneCharges: number;
  /** gold + wastage + making + stones — what GST is charged on. */
  gstBase: number;
  cgstAmount: number;
  sgstAmount: number;
  roundOff: number;
  lineTotal: number;
};

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function round3(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}

function toNumber(v: string | number | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Resolve a (value, mode) pair into ₹ against a base. Same semantics as
 * `resolveAmount` in components/ui/percent-or-rupee-input.tsx, minus the
 * "use client" boundary that keeps that copy out of server code.
 * Negative and non-numeric inputs resolve to 0.
 */
export function resolveCharge(
  value: string | number | null | undefined,
  mode: ChargeMode | null | undefined,
  base: number,
): number {
  const n = toNumber(value);
  if (n <= 0) return 0;
  return mode === "PERCENT" ? (base * n) / 100 : n;
}

/**
 * The single source of truth for what one ornament costs.
 *
 * Every component is rounded to the paise BEFORE the total is summed —
 * that is how a printed bill works, and it makes the client's figure and
 * the server's recomputation bit-identical rather than merely close.
 */
export function computeOrnamentLine(input: OrnamentLineInput): OrnamentLine {
  const gross = Math.max(0, toNumber(input.grossWeightGrams));
  const rate = Math.max(0, toNumber(input.ratePerGram));
  const stones = input.stones ?? [];

  const stoneWeightGrams = round3(
    stones.reduce((a, s) => a + Math.max(0, toNumber(s.weight)), 0),
  );
  const stoneCharges = round2(
    stones.reduce((a, s) => a + Math.max(0, toNumber(s.charge)), 0),
  );

  // Net gold is gross minus the stones set into it, so weight × rate is
  // the metal-only value. Clamped at 0 — the validator rejects stones
  // heavier than the piece, but a partially-typed form shouldn't produce
  // a negative gold value on the way there.
  const netWeightGrams = round3(Math.max(0, gross - stoneWeightGrams));
  const goldValue = round2(netWeightGrams * rate);

  const wastageAmount = round2(
    resolveCharge(input.wastageInput, input.wastageMode, goldValue),
  );
  const makingAmount = round2(
    resolveCharge(input.makingInput, input.makingMode, goldValue),
  );

  const gstBase = round2(
    goldValue + wastageAmount + makingAmount + stoneCharges,
  );
  const cgstAmount = round2(
    resolveCharge(input.cgstInput, input.cgstMode, gstBase),
  );
  const sgstAmount = round2(
    resolveCharge(input.sgstInput, input.sgstMode, gstBase),
  );

  // Round-off is the only signed component: −49 means the shop rounded
  // ₹3,38,149 down to ₹3,38,100.
  const roundOff = round2(toNumber(input.roundOff));

  const lineTotal = round2(gstBase + cgstAmount + sgstAmount + roundOff);

  return {
    stoneWeightGrams,
    netWeightGrams,
    goldValue,
    wastageAmount,
    makingAmount,
    stoneCharges,
    gstBase,
    cgstAmount,
    sgstAmount,
    roundOff,
    lineTotal,
  };
}

/**
 * Fineness by karat label. Unknown / "OTHER" falls back to 22K — the
 * dominant Indian ornament purity. Defaulting to 24K would overstate
 * every unlabelled piece, and inflating net worth is the worse error.
 */
export const KARAT_FACTORS: Record<string, number> = {
  "24K": 1,
  "22K": 22 / 24,
  "18K": 18 / 24,
  "14K": 14 / 24,
};

export const DEFAULT_KARAT_FACTOR = 22 / 24;

export function karatFactor(purity?: string | null): number {
  if (!purity) return DEFAULT_KARAT_FACTOR;
  return KARAT_FACTORS[purity.trim().toUpperCase()] ?? DEFAULT_KARAT_FACTOR;
}

/** Pure-gold equivalent of a piece — what a jeweller pays out on exchange. */
export function fineGrams(
  netWeightGrams: number,
  purity?: string | null,
): number {
  return round3(Math.max(0, toNumber(netWeightGrams)) * karatFactor(purity));
}

/**
 * Market value of one held piece at a given 24K rate. Stones are carried
 * at cost by default — they aren't gold, and revaluing a diamond piece
 * on the metal rate alone would report it as a ~60% loss.
 */
export function valueOrnamentAtRate(
  ornament: {
    netWeightGrams: number;
    purity?: string | null;
    stones?: GoldStoneInput[] | null;
  },
  ratePerGram24K: number,
  includeStonesAtCost = true,
): number {
  const metal = fineGrams(ornament.netWeightGrams, ornament.purity) *
    Math.max(0, toNumber(ratePerGram24K));
  const stones = includeStonesAtCost
    ? (ornament.stones ?? []).reduce(
        (a, s) => a + Math.max(0, toNumber(s.charge)),
        0,
      )
    : 0;
  return round2(metal + stones);
}

/** Carats → grams, for the stone repeater's one-shot weight fill. */
export function caratsToGrams(carats: number): number {
  return round3(Math.max(0, toNumber(carats)) * CARAT_TO_GRAM);
}

/** Carats × ₹/ct → the stone's ₹ line. */
export function stoneChargeFromCarats(
  carats: number,
  ratePerCt: number,
): number {
  return round2(
    Math.max(0, toNumber(carats)) * Math.max(0, toNumber(ratePerCt)),
  );
}
