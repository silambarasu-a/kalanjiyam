"use client";

import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { caratsToGrams, stoneChargeFromCarats } from "@/lib/gold";

export type StoneRow = {
  kind: string;
  weight: string;
  carats: string;
  ratePerCt: string;
  charge: string;
};

export const emptyStone = (): StoneRow => ({
  kind: "",
  weight: "",
  carats: "",
  ratePerCt: "",
  charge: "",
});

/**
 * Non-gold inclusions set into one ornament. Two things make this more
 * than a plain list: stone weight is deducted from gross so `net × rate`
 * stays metal-only, and the stone charges sit inside the GST base — which
 * is how Indian gold bills tax a stone-set piece.
 *
 * Carats is the bill's natural unit, so it drives both grams and the ₹
 * line. Weight is filled only when blank so a manual override sticks;
 * charge is recomputed whenever carats and rate are both present, because
 * there the itemised figures are the source of truth.
 */
export function GoldStonesRepeater({
  stones,
  onChange,
  disabled,
}: {
  stones: StoneRow[];
  onChange: (next: StoneRow[]) => void;
  disabled?: boolean;
}) {
  function update(i: number, patch: Partial<StoneRow>) {
    const next = stones.map((s, idx) => (idx === i ? { ...s, ...patch } : s));
    const row = next[i];
    const ct = parseFloat(row.carats) || 0;
    const rate = parseFloat(row.ratePerCt) || 0;
    if (ct > 0 && !row.weight) {
      row.weight = String(caratsToGrams(ct));
    }
    if (ct > 0 && rate > 0) {
      row.charge = String(stoneChargeFromCarats(ct, rate));
    }
    onChange(next);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">
          Stones {stones.length > 0 && `(${stones.length})`}
        </Label>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={disabled}
          onClick={() => onChange([...stones, emptyStone()])}
          className="h-7 gap-1 text-xs"
        >
          <Plus className="h-3 w-3" /> Add stone
        </Button>
      </div>

      {stones.map((s, i) => (
        <div
          key={i}
          className="grid grid-cols-2 gap-2 rounded-md border bg-muted/30 p-2 sm:grid-cols-6"
        >
          <Input
            value={s.kind}
            onChange={(e) => update(i, { kind: e.target.value })}
            placeholder="Diamond"
            disabled={disabled}
            className="sm:col-span-2"
          />
          <Input
            type="number"
            step="0.01"
            value={s.carats}
            onChange={(e) => update(i, { carats: e.target.value })}
            placeholder="ct"
            disabled={disabled}
          />
          <Input
            type="number"
            step="0.01"
            value={s.ratePerCt}
            onChange={(e) => update(i, { ratePerCt: e.target.value })}
            placeholder="₹/ct"
            disabled={disabled}
          />
          <Input
            type="number"
            step="0.001"
            value={s.weight}
            onChange={(e) => update(i, { weight: e.target.value })}
            placeholder="grams"
            disabled={disabled}
          />
          <div className="flex items-center gap-1">
            <Input
              type="number"
              step="0.01"
              value={s.charge}
              onChange={(e) => update(i, { charge: e.target.value })}
              placeholder="₹"
              disabled={disabled}
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              disabled={disabled}
              onClick={() => onChange(stones.filter((_, idx) => idx !== i))}
              aria-label="Remove stone"
              className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
