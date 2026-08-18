"use client";

import { Plus, X, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { AmountInput } from "@/components/ui/amount-input";
import { formatINR, cn } from "@/lib/utils";
import { round2 } from "@/lib/gold";

export type TenderRow = { source: string; amount: string };

/**
 * How the pieces you're KEEPING were paid for. A gold bill routinely goes
 * out on two cards and a bank account, so this is a list rather than one
 * picker.
 *
 * Ornaments bought for someone else are funded per-ornament instead, not
 * from here: one lump row split across two people would have to mint two
 * receivables for the same person on the same bill, which the split's
 * unique constraints forbid.
 */
export function GoldTenderSplits({
  splits,
  onChange,
  sources,
  target,
  disabled,
}: {
  splits: TenderRow[];
  onChange: (next: TenderRow[]) => void;
  sources: { value: string; label: string; hint?: string }[];
  /** Total of the ornaments being kept — what these rows must add up to. */
  target: number;
  disabled?: boolean;
}) {
  const paid = splits.reduce((a, s) => a + (parseFloat(s.amount) || 0), 0);
  const remaining = Math.round((target - paid) * 100) / 100;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">Paid from</Label>
        <div className="flex items-center gap-1">
          {Math.abs(remaining) > 0.01 && splits.length > 0 && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => {
                // Put the whole outstanding balance on the last row —
                // the common case is one payment source, and after a
                // trade-in the amount is rarely a round number.
                const last = splits.length - 1;
                const current = parseFloat(splits[last].amount) || 0;
                onChange(
                  splits.map((r, i) =>
                    i === last
                      ? { ...r, amount: String(round2(current + remaining)) }
                      : r,
                  ),
                );
              }}
              className="h-7 gap-1 text-xs"
            >
              <Wand2 className="h-3 w-3" /> Fill remaining
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => onChange([...splits, { source: "", amount: "" }])}
            className="h-7 gap-1 text-xs"
          >
            <Plus className="h-3 w-3" /> Add payment
          </Button>
        </div>
      </div>

      {splits.map((s, i) => (
        <div key={i} className="flex items-center gap-2">
          <NativeSelect
            value={s.source}
            onChange={(v) =>
              onChange(splits.map((r, idx) => (idx === i ? { ...r, source: v } : r)))
            }
            options={sources}
            placeholder="Account or card"
            className="flex-1"
            disabled={disabled}
          />
          <AmountInput
            value={s.amount}
            onChange={(v) =>
              onChange(splits.map((r, idx) => (idx === i ? { ...r, amount: v } : r)))
            }
            className="w-32"
            disabled={disabled}
          />
          {splits.length > 1 && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              disabled={disabled}
              onClick={() => onChange(splits.filter((_, idx) => idx !== i))}
              aria-label="Remove payment"
              className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      ))}

      <div
        className={cn(
          "flex items-center justify-between rounded-md px-2 py-1.5 text-xs tabular-nums",
          Math.abs(remaining) <= 0.01
            ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
            : "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
        )}
      >
        <span>
          {Math.abs(remaining) <= 0.01
            ? `Payments match the ${formatINR(target)} due`
            : remaining > 0
              ? `Still to allocate (of ${formatINR(target)} due)`
              : `Over-allocated — only ${formatINR(target)} is due`}
        </span>
        <span className="font-semibold">
          {Math.abs(remaining) <= 0.01
            ? formatINR(target)
            : formatINR(Math.abs(remaining))}
        </span>
      </div>
    </div>
  );
}
