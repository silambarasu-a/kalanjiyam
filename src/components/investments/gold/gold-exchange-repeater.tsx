"use client";

import useSWR from "swr";
import { Plus, X, Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { AmountInput } from "@/components/ui/amount-input";
import { fetcher } from "@/lib/swr-fetcher";
import { suggestExchangeCredit } from "@/lib/gold";
import { formatINR, cn } from "@/lib/utils";
import type { GoldOrnamentRow } from "@/components/investments/gold/gold-portfolio";

export type ExchangeRow = {
  /** Set when trading in a piece already tracked here. */
  ornamentId: string;
  name: string;
  grossWeightGrams: string;
  purity: string;
  ratePerGram: string;
  deductionPercent: string;
  creditAmount: string;
  assumedCostBasis: string;
  notes: string;
};

export const emptyExchange = (): ExchangeRow => ({
  ornamentId: "",
  name: "",
  grossWeightGrams: "",
  purity: "22K",
  ratePerGram: "",
  deductionPercent: "",
  creditAmount: "",
  assumedCostBasis: "",
  notes: "",
});

const PURITY_OPTIONS = ["24K", "22K", "18K", "14K", "OTHER"].map((v) => ({
  value: v,
  label: v,
}));

/**
 * Old gold handed to the jeweller against this bill.
 *
 * This is a disposal that happens to be tendered rather than banked — the
 * new ornaments keep their full cost basis and the old piece realises its
 * own gain. Netting the credit off the new pieces instead (which is what
 * squeezing it into round-off would do) would understate their basis and
 * hide the gain completely.
 */
export function GoldExchangeRepeater({
  exchanges,
  onChange,
}: {
  exchanges: ExchangeRow[];
  onChange: (next: ExchangeRow[]) => void;
}) {
  // Only pieces still held and actually ours can be traded in.
  const { data } = useSWR<{ ornaments: GoldOrnamentRow[] }>(
    "/api/gold/ornaments?status=HELD",
    fetcher,
  );
  const holdings = (data?.ornaments ?? []).filter((o) => !o.boughtForContact);

  const total = exchanges.reduce(
    (a, e) => a + (parseFloat(e.creditAmount) || 0),
    0,
  );

  function update(i: number, patch: Partial<ExchangeRow>) {
    onChange(exchanges.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));
  }

  function pickHolding(i: number, ornamentId: string) {
    const held = holdings.find((h) => h.id === ornamentId);
    update(i, {
      ornamentId,
      ...(held
        ? {
            name: held.name,
            grossWeightGrams: String(held.netWeightGrams),
            purity: held.purity ?? "22K",
            // A tracked piece carries its own basis already.
            assumedCostBasis: "",
          }
        : {}),
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm font-medium">Old gold exchanged</Label>
          <p className="text-xs text-muted-foreground">
            Reduces what you pay in cash. The new ornaments still carry
            their full value — the old piece realises its own gain.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => onChange([...exchanges, emptyExchange()])}
          className="h-7 shrink-0 gap-1 text-xs"
        >
          <Plus className="h-3 w-3" /> Add old gold
        </Button>
      </div>

      {exchanges.map((e, i) => {
        const suggested = suggestExchangeCredit({
          grossWeightGrams: parseFloat(e.grossWeightGrams) || 0,
          ratePerGram: parseFloat(e.ratePerGram) || 0,
          deductionPercent: parseFloat(e.deductionPercent) || 0,
        });
        const entered = parseFloat(e.creditAmount) || 0;
        const drifted =
          suggested > 0 && entered > 0 && Math.abs(suggested - entered) > 1;

        return (
          <div
            key={i}
            className="space-y-2 rounded-lg border border-violet-300/70 bg-violet-50/50 p-3 dark:border-violet-700/50 dark:bg-violet-950/20"
          >
            <div className="flex items-center gap-2">
              <Repeat className="h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400" />
              <span className="flex-1 text-xs font-medium">
                Trade-in {i + 1}
              </span>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={() => onChange(exchanges.filter((_, x) => x !== i))}
                aria-label="Remove trade-in"
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">
                From your holdings (optional)
              </Label>
              <NativeSelect
                value={e.ornamentId}
                onChange={(v) => pickHolding(i, v)}
                options={[
                  { value: "", label: "— untracked old gold —" },
                  ...holdings.map((h) => ({
                    value: h.id,
                    label: h.name,
                    hint: `${h.netWeightGrams}g ${h.purity ?? ""}`,
                  })),
                ]}
                searchable
                placeholder="Untracked old gold"
              />
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="sm:col-span-2">
                <Label className="text-xs text-muted-foreground">
                  Description
                </Label>
                <Input
                  value={e.name}
                  onChange={(ev) => update(i, { name: ev.target.value })}
                  placeholder="Old bangles"
                  disabled={!!e.ornamentId}
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">
                  Weight (g)
                </Label>
                <Input
                  type="number"
                  step="0.001"
                  value={e.grossWeightGrams}
                  onChange={(ev) =>
                    update(i, { grossWeightGrams: ev.target.value })
                  }
                  disabled={!!e.ornamentId}
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Purity</Label>
                <NativeSelect
                  value={e.purity}
                  onChange={(v) => update(i, { purity: v })}
                  options={PURITY_OPTIONS}
                  disabled={!!e.ornamentId}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <div>
                <Label className="text-xs text-muted-foreground">
                  Rate ₹/g
                </Label>
                <Input
                  type="number"
                  step="0.01"
                  value={e.ratePerGram}
                  onChange={(ev) => update(i, { ratePerGram: ev.target.value })}
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">
                  Melting loss %
                </Label>
                <Input
                  type="number"
                  step="0.01"
                  value={e.deductionPercent}
                  onChange={(ev) =>
                    update(i, { deductionPercent: ev.target.value })
                  }
                  placeholder="8"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">
                  Credit given
                </Label>
                <AmountInput
                  value={e.creditAmount}
                  onChange={(v) => update(i, { creditAmount: v })}
                />
              </div>
            </div>

            {suggested > 0 && (
              <p
                className={cn(
                  "text-xs",
                  drifted
                    ? "text-amber-700 dark:text-amber-400"
                    : "text-muted-foreground",
                )}
              >
                Weight less melting loss at that rate comes to{" "}
                {formatINR(suggested)}.
                {!e.creditAmount && (
                  <button
                    type="button"
                    onClick={() =>
                      update(i, { creditAmount: String(suggested) })
                    }
                    className="ml-1 font-medium text-primary underline-offset-2 hover:underline"
                  >
                    Use it
                  </button>
                )}
                {drifted && " The shop's figure is what counts."}
              </p>
            )}

            {!e.ornamentId && (
              <div>
                <Label className="text-xs text-muted-foreground">
                  What it originally cost you (optional)
                </Label>
                <AmountInput
                  value={e.assumedCostBasis}
                  onChange={(v) => update(i, { assumedCostBasis: v })}
                />
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Left blank, the whole credit reads as a gain — truthful
                  for gold you never paid for through this app.
                </p>
              </div>
            )}
          </div>
        );
      })}

      {exchanges.length > 0 && (
        <div className="flex items-center justify-between rounded-md bg-violet-100 px-2 py-1.5 text-xs tabular-nums text-violet-900 dark:bg-violet-950/50 dark:text-violet-200">
          <span>Old-gold credit</span>
          <span className="font-semibold">−{formatINR(total)}</span>
        </div>
      )}
    </div>
  );
}
