"use client";

import { formatINR } from "@/lib/utils";

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
export function GoldBreakdown({
  weight,
  ratePerGram,
  goldValue,
  wastage,
  making,
  gst,
  showWastage = true,
  showMaking = true,
  onUseTotal,
}: {
  weight: number;
  ratePerGram: number;
  goldValue: number;
  wastage: number;
  making: number;
  gst: number;
  showWastage?: boolean;
  showMaking?: boolean;
  onUseTotal?: (total: number) => void;
}) {
  const total = goldValue + wastage + making + gst;
  const gstBase = goldValue + wastage + making;

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
      <Row label="GST" amount={gst} meta={pctMeta(gst, gstBase)} />
      <div className="flex items-center justify-between border-t pt-1.5">
        <span className="font-semibold">Total</span>
        <div className="flex items-center gap-3">
          <span className="text-base font-bold tabular-nums">{formatINR(total)}</span>
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
}: {
  label: string;
  amount: number;
  meta?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-2">
        <span className="tabular-nums">
          {amount > 0 ? formatINR(amount) : <span className="text-muted-foreground">—</span>}
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
