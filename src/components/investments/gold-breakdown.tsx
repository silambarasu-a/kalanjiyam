"use client";

/**
 * Local INR formatter that keeps 2 decimal places — gold/jewellery bills
 * report amounts to the paise (e.g. ₹2,84,504.36). The shared `formatINR`
 * rounds to whole rupees, which would make the breakdown drift from the
 * user's receipt.
 */
const inrFmt = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const formatINR2 = (n: number) => inrFmt.format(n);

/**
 * Detailed line-item breakdown shown below the GOLD inputs. Each row shows
 * the ₹ amount AND the equivalent percentage so the user can compare what
 * the shop quoted them in either form.
 *
 *   Wastage  ₹ 42,462  (10.55%)
 *   Making   —
 *   GST      ₹ 2,203   (3%)
 *
 * For wastage / making the percentage is relative to the gold value
 * (weight × rate). For GST it's relative to the taxable value (gold +
 * wastage + making) — matching how Indian gold receipts compute it.
 */
export type GoldStone = {
  /** Free-form label — e.g. "Diamond", "Ruby", "Kundan". Null = unlabelled. */
  kind?: string | null;
  /** Stone weight in grams (informational; deducted from gross to get net gold). */
  weight: number;
  /** Carats — bill's natural unit. 1ct = 0.2g. Optional. */
  carats?: number;
  /** Rate per carat in ₹. Optional; if present alongside `carats`,
   * `charge` is just `carats × ratePerCt`. */
  ratePerCt?: number;
  /** Separate ₹ line for this stone. Adds to total. */
  charge: number;
};

export function GoldBreakdown({
  weight,
  ratePerGram,
  goldValue,
  wastage,
  making,
  cgst,
  sgst,
  roundOff = 0,
  stones,
  showWastage = true,
  showMaking = true,
  onUseTotal,
}: {
  weight: number;
  ratePerGram: number;
  goldValue: number;
  wastage: number;
  making: number;
  /** Central GST in ₹ (already resolved from % or rupee mode). */
  cgst: number;
  /** State GST in ₹. For interstate purchases the bill collapses both
   * into a single IGST line — the user can put the full slab in either
   * field and leave the other zero. */
  sgst: number;
  /** Bill-level round-off. Negative = rounded down (e.g. ₹338,149 → ₹338,100
   * is `roundOff = -49`). Adds to total. */
  roundOff?: number;
  /** One entry per non-gold inclusion. Stones sit inside the GST base —
   * most household gold bills tax (gold + making + wastage + stones) at
   * a single slab. */
  stones?: GoldStone[];
  showWastage?: boolean;
  showMaking?: boolean;
  onUseTotal?: (total: number) => void;
}) {
  const stoneCharges = (stones ?? []).reduce((a, s) => a + s.charge, 0);
  const total = goldValue + wastage + making + stoneCharges + cgst + sgst + roundOff;
  const gstBase = goldValue + wastage + making + stoneCharges;

  return (
    <div className="rounded-md border bg-background/60 px-3 py-2 text-xs space-y-1.5">
      <Row
        label="Gold value"
        amount={goldValue}
        meta={`${weight}g × ₹${ratePerGram}`}
      />
      {showWastage && (
        <Row
          label="Wastage"
          amount={wastage}
          meta={pctMeta(wastage, goldValue)}
        />
      )}
      {showMaking && (
        <Row
          label="Making"
          amount={making}
          meta={pctMeta(making, goldValue)}
        />
      )}
      {(stones ?? []).map((s, i) => {
        const meta =
          s.carats && s.ratePerCt
            ? `${s.carats}ct × ₹${s.ratePerCt}`
            : s.carats
              ? `${s.carats}ct`
              : s.weight > 0
                ? `${s.weight}g`
                : undefined;
        return (
          <Row
            key={i}
            label={s.kind ? `Stones · ${s.kind}` : "Stones"}
            amount={s.charge}
            meta={meta}
          />
        );
      })}
      <Row label="CGST" amount={cgst} meta={pctMeta(cgst, gstBase)} />
      <Row label="SGST" amount={sgst} meta={pctMeta(sgst, gstBase)} />
      {roundOff !== 0 && (
        <Row
          label="Round-off"
          amount={roundOff}
          meta={undefined}
          allowNegative
        />
      )}
      <div className="flex items-center justify-between border-t pt-1.5">
        <span className="font-semibold">Total</span>
        <div className="flex items-center gap-3">
          <span className="text-base font-bold tabular-nums">{formatINR2(total)}</span>
          {onUseTotal && (
            <button
              type="button"
              onClick={() => onUseTotal(total)}
              className="text-[11px] font-medium text-primary underline-offset-2 hover:underline"
            >
              Use as amount
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  amount,
  meta,
  allowNegative = false,
}: {
  label: string;
  amount: number;
  meta?: string;
  /** Show negative values verbatim (with sign) instead of falling back to —.
   * Used for round-off where −₹49 is the meaningful value. */
  allowNegative?: boolean;
}) {
  const display =
    amount > 0
      ? formatINR2(amount)
      : allowNegative && amount < 0
        ? `−${formatINR2(Math.abs(amount))}`
        : null;
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-2">
        <span className="tabular-nums">
          {display ?? <span className="text-muted-foreground">—</span>}
        </span>
        {meta && <span className="text-[10px] text-muted-foreground tabular-nums">{meta}</span>}
      </span>
    </div>
  );
}

function pctMeta(amount: number, base: number): string | undefined {
  if (amount <= 0 || base <= 0) return undefined;
  const pct = (amount / base) * 100;
  return `(${pct.toFixed(pct >= 10 ? 1 : 2)}%)`;
}
