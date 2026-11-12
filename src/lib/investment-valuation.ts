/**
 * What a holding is worth today — the pure half (no prisma, no React),
 * shared by the investments list, the holding page and the dashboard so
 * they can never disagree.
 *
 * `Investment.amount` is cost and `Investment.currentValue` is only ever
 * written by a few manual flows (gold revaluation, FD interest confirm).
 * Left alone, every deposit and fund shows what you paid for it. This
 * module derives the real figure instead:
 *
 *   STOCK              shares × live price (× USD/INR)
 *   MUTUAL_FUND / SIP  units × latest AMFI NAV
 *   FD / RD            principal grown at the deposit's rate, up to the
 *                      maturity amount
 *   everything else    the stored `currentValue`, else cost
 *
 * Nothing here is persisted. Every figure is recomputed on read from the
 * holding's own fields plus whatever market data the caller has.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const DAYS_PER_MONTH = 365.25 / 12;

export const COMPOUNDING_FREQUENCIES = [
  "MONTHLY",
  "QUARTERLY",
  "HALF_YEARLY",
  "YEARLY",
] as const;
export type CompoundingFrequency = (typeof COMPOUNDING_FREQUENCIES)[number];

/** Indian bank deposits compound quarterly unless the receipt says otherwise. */
export const DEFAULT_COMPOUNDING: CompoundingFrequency = "QUARTERLY";

export const COMPOUNDING_LABEL: Record<CompoundingFrequency, string> = {
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  HALF_YEARLY: "Half-yearly",
  YEARLY: "Yearly",
};

const PERIODS_PER_YEAR: Record<CompoundingFrequency, number> = {
  MONTHLY: 12,
  QUARTERLY: 4,
  HALF_YEARLY: 2,
  YEARLY: 1,
};

export function asCompounding(v: string | null | undefined): CompoundingFrequency {
  return (COMPOUNDING_FREQUENCIES as readonly string[]).includes(v ?? "")
    ? (v as CompoundingFrequency)
    : DEFAULT_COMPOUNDING;
}

/** The fields valuation reads — a subset of what the investments API returns. */
export type HoldingForValuation = {
  kind: string;
  amount: number;
  currentValue: number | null;
  interestRate?: number | null;
  compoundingFrequency?: string | null;
  startedAt: string | Date;
  maturityAt?: string | Date | null;
  /** FD / RD: the maturity amount printed on the receipt, when entered. */
  maturityValue?: number | null;
  quantity?: number | null;
  purchasePrice?: number | null;
  purchaseExchangeRate?: number | null;
  currency?: string | null;
  /** RD: the monthly instalment. */
  premiumAmount?: number | null;
  metadata?: unknown;
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Whole days since the epoch for the calendar day `d` falls on (UTC). */
function dayNumber(d: string | Date): number {
  const t = typeof d === "string" ? new Date(d).getTime() : d.getTime();
  return Math.floor(t / DAY_MS);
}

/**
 * Today as a day number. Dates are stored as UTC midnights of the day the
 * user picked, so "today" has to be the user's calendar day, not the UTC
 * one — otherwise a deposit maturing today reads "in 1 day" until 05:30 IST.
 */
function todayNumber(now: Date): number {
  return Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / DAY_MS);
}

/* ------------------------------ Deposits ------------------------------ */

export type DepositValuation = {
  /** FD: the principal. RD: what has been deposited so far. */
  principal: number;
  ratePct: number | null;
  compounding: CompoundingFrequency;
  tenureDays: number | null;
  /** Negative once the maturity date has passed. Null with no maturity date. */
  daysToMaturity: number | null;
  matured: boolean;
  maturityAmount: number | null;
  /** True when `maturityAmount` is the figure the user entered, not our estimate. */
  maturityStated: boolean;
  /** Maturity amount − everything paid in. Null when either side is unknown. */
  interestAtMaturity: number | null;
  /** RD only: instalment × months, when both are known. */
  totalDeposits: number | null;
  valueToday: number;
  /** valueToday − principal. */
  interestAccrued: number;
  /** False when there is nothing to accrue with (no rate, no maturity amount). */
  accrues: boolean;
};

/** Compound growth of `principal` over `years` at `ratePct` p.a. */
export function compound(
  principal: number,
  ratePct: number,
  years: number,
  compounding: CompoundingFrequency = DEFAULT_COMPOUNDING,
): number {
  const n = PERIODS_PER_YEAR[compounding];
  return principal * Math.pow(1 + ratePct / 100 / n, n * years);
}

/**
 * Maturity amount of a recurring deposit: every monthly instalment grows
 * from the month it is paid until maturity.
 */
export function recurringMaturity(
  instalment: number,
  ratePct: number,
  months: number,
  compounding: CompoundingFrequency = DEFAULT_COMPOUNDING,
): number {
  let total = 0;
  for (let k = 0; k < months; k++) {
    total += compound(instalment, ratePct, (months - k) / 12, compounding);
  }
  return total;
}

/**
 * Value a fixed or recurring deposit.
 *
 * The maturity amount is the one on the receipt when the user entered it
 * (`maturityValue`) — banks round, pay simple interest on short tenures,
 * and non-cumulative deposits pay the interest out instead of adding it —
 * and otherwise our compound-interest estimate.
 *
 * The value today then walks from principal to that maturity amount along
 * a compound curve, so it always lands exactly on the maturity amount on
 * the maturity date whichever of the two it is.
 */
export function depositValuation(
  h: HoldingForValuation,
  now: Date = new Date(),
): DepositValuation {
  const isRecurring = h.kind === "RD";
  const principal = Math.max(0, h.amount);
  const ratePct = h.interestRate != null && h.interestRate > 0 ? h.interestRate : null;
  const compounding = asCompounding(h.compoundingFrequency);

  const start = dayNumber(h.startedAt);
  const today = todayNumber(now);
  const maturity = h.maturityAt ? dayNumber(h.maturityAt) : null;
  const tenureDays = maturity != null && maturity > start ? maturity - start : null;
  const daysToMaturity = maturity != null ? maturity - today : null;
  const matured = daysToMaturity != null && daysToMaturity <= 0;
  const elapsedDays = Math.max(0, today - start);

  const stated = h.maturityValue != null && h.maturityValue > 0 ? h.maturityValue : null;

  if (!isRecurring) {
    const estimate =
      ratePct != null && tenureDays != null && principal > 0
        ? compound(principal, ratePct, tenureDays / 365, compounding)
        : null;
    const maturityAmount = stated ?? estimate;

    let valueToday = principal;
    let accrues = false;
    if (principal > 0 && maturityAmount != null && tenureDays != null) {
      const f = Math.min(1, elapsedDays / tenureDays);
      valueToday = principal * Math.pow(maturityAmount / principal, f);
      accrues = true;
    } else if (principal > 0 && ratePct != null) {
      // No maturity date (or an open-ended deposit): keep compounding.
      valueToday = compound(principal, ratePct, elapsedDays / 365, compounding);
      accrues = true;
    }

    return {
      principal,
      ratePct,
      compounding,
      tenureDays,
      daysToMaturity,
      matured,
      maturityAmount: maturityAmount != null ? round2(maturityAmount) : null,
      maturityStated: stated != null,
      interestAtMaturity:
        maturityAmount != null ? round2(maturityAmount - principal) : null,
      totalDeposits: null,
      valueToday: round2(valueToday),
      interestAccrued: round2(valueToday - principal),
      accrues,
    };
  }

  // ── Recurring deposit ────────────────────────────────────────────────
  const months = tenureDays != null ? Math.max(1, Math.round(tenureDays / DAYS_PER_MONTH)) : null;
  const instalment = h.premiumAmount != null && h.premiumAmount > 0 ? h.premiumAmount : null;
  const totalDeposits = instalment != null && months != null ? instalment * months : null;
  const estimate =
    instalment != null && ratePct != null && months != null
      ? recurringMaturity(instalment, ratePct, months, compounding)
      : null;
  const maturityAmount = stated ?? estimate;

  let valueToday = principal;
  let accrues = false;
  if (principal > 0 && matured && maturityAmount != null) {
    valueToday = maturityAmount;
    accrues = true;
  } else if (principal > 0 && ratePct != null) {
    // Spread what has actually been deposited evenly over the instalments
    // that should have been paid by now, and grow each from its own month.
    // Using the real total keeps a skipped instalment from being imagined.
    const elapsedMonths = Math.min(elapsedDays / DAYS_PER_MONTH, months ?? Infinity);
    const paid = Math.max(1, Math.min(Math.floor(elapsedMonths) + 1, months ?? Infinity));
    const each = principal / paid;
    let total = 0;
    for (let j = 0; j < paid; j++) {
      total += compound(each, ratePct, Math.max(0, elapsedMonths - j) / 12, compounding);
    }
    valueToday = total;
    accrues = true;
  }

  return {
    principal,
    ratePct,
    compounding,
    tenureDays,
    daysToMaturity,
    matured,
    maturityAmount: maturityAmount != null ? round2(maturityAmount) : null,
    maturityStated: stated != null,
    interestAtMaturity:
      maturityAmount != null && totalDeposits != null
        ? round2(maturityAmount - totalDeposits)
        : null,
    totalDeposits: totalDeposits != null ? round2(totalDeposits) : null,
    valueToday: round2(valueToday),
    interestAccrued: round2(valueToday - principal),
    accrues,
  };
}

/* ------------------------------- Funds -------------------------------- */

/** AMFI scheme code a MUTUAL_FUND / SIP holding is linked to, if any. */
export function amfiSchemeCode(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const code = (metadata as Record<string, unknown>).amfiSchemeCode;
  return code == null || code === "" ? null : String(code);
}

export type FundNavInput = { nav: number; navDate: string | null } | null | undefined;

export type FundValuation = {
  units: number | null;
  /** Average NAV paid: the stored weighted average, else cost ÷ units. */
  avgNav: number | null;
  nav: number | null;
  navDate: string | null;
  /** units × latest NAV. Null when it can't be worked out — see `missing`. */
  marketValue: number | null;
  /**
   * Why there is no market value:
   *   SCHEME  not linked to an AMFI scheme, so there is no NAV to look up
   *   UNITS   no units recorded on the holding
   *   PARTIAL some of the money went in without units (e.g. SIP instalments
   *           confirmed from a reminder), so units × NAV would understate
   *           the holding and report a loss that isn't there
   *   NAV     AMFI has no NAV for the scheme, or the feed is unreachable
   *   MISMATCH the scheme's NAV is nowhere near what the units were bought
   *           at — the holding is linked to the wrong plan / option of the
   *           fund (Growth vs IDCW NAVs differ twenty-fold), or its units
   *           or average NAV were mistyped. Multiplying the two would
   *           invent a gain or a loss.
   */
  missing: "SCHEME" | "UNITS" | "PARTIAL" | "NAV" | "MISMATCH" | null;
};

/**
 * Units must account for at least this share of the money invested before
 * units × NAV is trusted as the holding's value.
 */
const UNITS_COVERAGE_MIN = 0.9;

/**
 * Is `nav` a believable price today for units bought at `avgNav`, `years`
 * ago? Generous on purpose — the aim is to catch a wrong scheme (off by
 * 10×–30×), not to second-guess a good or bad fund: up to 3× straight
 * away plus 30% a year compounding on top, down to a fifth.
 */
function navPlausible(nav: number, avgNav: number, years: number): boolean {
  const ratio = nav / avgNav;
  return ratio <= 3 * Math.pow(1.3, Math.max(0, years)) && ratio >= 0.2;
}

export function fundValuation(
  h: HoldingForValuation,
  nav: FundNavInput,
  now: Date = new Date(),
): FundValuation {
  const units = h.quantity != null && h.quantity > 0 ? h.quantity : null;
  const avgNav =
    h.purchasePrice != null && h.purchasePrice > 0
      ? h.purchasePrice
      : units != null && h.amount > 0
        ? h.amount / units
        : null;
  const base = {
    units,
    avgNav,
    nav: nav?.nav ?? null,
    navDate: nav?.navDate ?? null,
  };
  if (!amfiSchemeCode(h.metadata)) return { ...base, marketValue: null, missing: "SCHEME" };
  if (units == null) return { ...base, marketValue: null, missing: "UNITS" };
  if (
    h.purchasePrice != null &&
    h.purchasePrice > 0 &&
    units * h.purchasePrice < h.amount * UNITS_COVERAGE_MIN
  ) {
    return { ...base, marketValue: null, missing: "PARTIAL" };
  }
  if (!nav || !(nav.nav > 0)) return { ...base, marketValue: null, missing: "NAV" };
  if (avgNav != null) {
    const years = Math.max(0, todayNumber(now) - dayNumber(h.startedAt)) / 365;
    if (!navPlausible(nav.nav, avgNav, years)) {
      return { ...base, marketValue: null, missing: "MISMATCH" };
    }
  }
  return { ...base, marketValue: round2(units * nav.nav), missing: null };
}

/* ------------------------------ Any kind ------------------------------ */

export type HoldingValue = {
  invested: number;
  current: number;
  gain: number;
  gainPct: number;
  /**
   * Where `current` came from:
   *   LIVE     live share price          NAV      latest AMFI NAV
   *   ACCRUED  interest accrued to date  MATURED  the deposit's maturity amount
   *   STORED   a value saved on the holding (gold revaluation, …)
   *   COST     nothing better known — shown at what was paid
   */
  basis: "LIVE" | "NAV" | "ACCRUED" | "MATURED" | "STORED" | "COST";
};

export type MarketData = {
  now?: Date;
  /** Latest NAV for the holding's scheme (MUTUAL_FUND / SIP). */
  nav?: FundNavInput;
  /** Live price in the holding's own currency (STOCK). */
  price?: number | null;
  usdInrRate?: number;
};

export function isDepositKind(kind: string): boolean {
  return kind === "FD" || kind === "RD";
}

export function isFundKind(kind: string): boolean {
  return kind === "MUTUAL_FUND" || kind === "SIP";
}

export function valueHolding(h: HoldingForValuation, market: MarketData = {}): HoldingValue {
  const stored = h.currentValue != null ? h.currentValue : null;
  let invested = h.amount;
  let current = stored ?? invested;
  let basis: HoldingValue["basis"] = stored != null ? "STORED" : "COST";

  if (h.kind === "STOCK") {
    const qty = h.quantity ?? 0;
    const isUsd = h.currency === "USD";
    const rate = isUsd ? (market.usdInrRate ?? 0) : 1;
    // Cost basis = stored INR `amount` (maintained server-side as the
    // weighted-average total cost). Legacy rows without it fall back to
    // qty × price × the rate they were bought at.
    if (!(invested > 0)) {
      invested = qty * (h.purchasePrice ?? 0) * (isUsd ? (h.purchaseExchangeRate ?? rate) : 1);
    }
    const price = market.price ?? 0;
    if (price > 0 && qty > 0 && rate > 0) {
      current = qty * price * rate;
      basis = "LIVE";
    } else {
      current = invested;
      basis = "COST";
    }
  } else if (isFundKind(h.kind)) {
    const f = fundValuation(h, market.nav, market.now);
    if (f.marketValue != null) {
      current = f.marketValue;
      basis = "NAV";
    }
  } else if (isDepositKind(h.kind)) {
    const d = depositValuation(h, market.now);
    if (d.accrues) {
      current = d.valueToday;
      basis = d.matured && d.maturityAmount != null ? "MATURED" : "ACCRUED";
    }
  }

  const gain = current - invested;
  return {
    invested,
    current,
    gain,
    gainPct: invested > 0 ? (gain / invested) * 100 : 0,
    basis,
  };
}

/* ------------------------------ Wording ------------------------------- */

/** "91 days", "18 months", "2 yr 6 mo". */
export function formatTenure(days: number): string {
  if (days < 60) return `${days} day${days === 1 ? "" : "s"}`;
  const months = Math.round(days / DAYS_PER_MONTH);
  if (months < 12) return `${months} months`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return rem === 0 ? `${years} yr` : `${years} yr ${rem} mo`;
}

/** "in 120 days", "tomorrow", "today", "12 days ago". */
export function formatDaysAway(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

/** Days from today (the user's calendar day) to `date`; negative when past. */
export function daysUntil(date: string | Date, now: Date = new Date()): number {
  return dayNumber(date) - todayNumber(now);
}
