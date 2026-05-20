"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import {
  Activity,
  Stethoscope,
  Utensils,
  Wallet,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DateInput } from "@/components/ui/date-input";
import { AmountInput } from "@/components/ui/amount-input";
import { NativeSelect } from "@/components/ui/native-select";
import { DescriptionField } from "@/components/ui/description-field";
import { mutateBalances } from "@/lib/mutate-balances";
import { formatINR, groupAccountOptions } from "@/lib/utils";
import { fetcher } from "@/lib/swr-fetcher";

type Account = {
  id: string;
  name: string;
  kind: string;
  balance: number;
  availableLimit: number | null;
};

export type BatchActionTab = "event" | "feed" | "vaccination";

type BatchRef = {
  id: string;
  name: string;
  currentCount: number;
  livestockId: string;
};

/**
 * Shared dialog for the three batch-level recurring actions: log an
 * event (PURCHASE / BIRTH / DEATH / SALE), feed, or vaccination.
 * Used from both `/livestock/[id]` (batches grid) and
 * `/livestock/[id]/batches/[batchId]` (detail page).
 *
 * For SALE / PURCHASE the form supports two pricing modes:
 *   - per-animal — the legacy field (e.g. day-old chicks at ₹45 each)
 *   - per-kg     — total weight × ₹/kg (e.g. goats sold at ₹400/kg
 *                   for a 28 kg lot)
 * Per-kg mode derives `unitValue = (totalKg × ratePerKg) / count` and
 * `avgWeightKg = totalKg / count` so the persisted event row matches
 * the existing schema; the API doesn't need to change.
 */
export function BatchActionDialog({
  batch,
  tab,
  open,
  onOpenChange,
}: {
  batch: BatchRef | null;
  tab: BatchActionTab | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const { data: accountsData } = useSWR<{ accounts: Account[] }>(
    open ? "/api/accounts" : null,
    fetcher,
  );
  const accounts = (accountsData?.accounts ?? []).filter(
    (a) => a.kind !== "CARD",
  );

  const [eventType, setEventType] = useState<
    "PURCHASE" | "BIRTH" | "DEATH" | "SALE"
  >("BIRTH");
  const [count, setCount] = useState("1");
  // Pricing mode for SALE/PURCHASE only.
  const [pricingMode, setPricingMode] = useState<"per-animal" | "per-kg">(
    "per-animal",
  );
  const [unitValue, setUnitValue] = useState(""); // per-animal mode
  const [totalKg, setTotalKg] = useState(""); // per-kg mode
  const [ratePerKg, setRatePerKg] = useState(""); // per-kg mode
  const [avgWeightKg, setAvgWeightKg] = useState(""); // per-animal mode (optional)
  const [feedAmount, setFeedAmount] = useState("");
  const [feedQuantity, setFeedQuantity] = useState("");
  const [feedUnit, setFeedUnit] = useState("");
  const [vaccine, setVaccine] = useState("");
  const [nextDueDate, setNextDueDate] = useState("");
  const [vaccinationCost, setVaccinationCost] = useState("");
  const [date, setDate] = useState(today);
  const [accountId, setAccountId] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- reset on open */
    setEventType("BIRTH");
    setCount("1");
    setPricingMode("per-animal");
    setUnitValue("");
    setTotalKg("");
    setRatePerKg("");
    setAvgWeightKg("");
    setFeedAmount("");
    setFeedQuantity("");
    setFeedUnit("");
    setVaccine("");
    setNextDueDate("");
    setVaccinationCost("");
    setDate(today);
    setAccountId("");
    setNotes("");
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, today]);

  if (!batch || !tab) return null;

  // ── Per-kg → per-animal derivation ────────────────────────────────
  // Both `avgWeightKg` and per-animal `unitValue` are derived from
  // `(count, totalKg, ratePerKg)`. Stored on the event row so existing
  // readers (event table, FCR) keep working unchanged.
  const countN = Number(count) || 0;
  const totalKgN = Number(totalKg) || 0;
  const ratePerKgN = Number(ratePerKg) || 0;
  const derivedUnitValue =
    pricingMode === "per-kg" && countN > 0
      ? +((totalKgN * ratePerKgN) / countN).toFixed(2)
      : null;
  const derivedAvgWeight =
    pricingMode === "per-kg" && countN > 0
      ? +(totalKgN / countN).toFixed(3)
      : null;
  const effectiveUnitValue =
    pricingMode === "per-kg" ? derivedUnitValue : Number(unitValue) || null;
  const effectiveAvgWeight =
    pricingMode === "per-kg"
      ? derivedAvgWeight
      : avgWeightKg
        ? Number(avgWeightKg)
        : null;
  const totalAmount =
    pricingMode === "per-kg"
      ? +(totalKgN * ratePerKgN).toFixed(2)
      : +(countN * (Number(unitValue) || 0)).toFixed(2);

  const isFinancial =
    (tab === "event" && (eventType === "SALE" || eventType === "PURCHASE")) ||
    tab === "feed" ||
    (tab === "vaccination" && Number(vaccinationCost) > 0);

  async function submit() {
    if (!batch || !tab) return;
    setError(null);
    setSubmitting(true);
    try {
      let url = "";
      let payload: Record<string, unknown> = {};
      if (tab === "event") {
        url = `/api/livestock-batches/${batch.id}/events`;
        payload = {
          eventType,
          date,
          count: countN,
          unitValue: effectiveUnitValue,
          avgWeightKg: effectiveAvgWeight,
          totalWeightKg:
            pricingMode === "per-kg" && totalKgN > 0 ? totalKgN : undefined,
          notes: notes.trim() || undefined,
          accountId: accountId || undefined,
        };
      } else if (tab === "feed") {
        url = `/api/livestock-batches/${batch.id}/feed`;
        payload = {
          date,
          amount: Number(feedAmount) || 0,
          quantity: feedQuantity ? Number(feedQuantity) : null,
          unit: feedUnit || undefined,
          notes: notes.trim() || undefined,
          accountId: accountId || undefined,
        };
      } else {
        url = `/api/livestock-batches/${batch.id}/vaccination`;
        payload = {
          vaccine,
          date,
          nextDueDate: nextDueDate || null,
          cost: vaccinationCost ? Number(vaccinationCost) : null,
          notes: notes.trim() || undefined,
          accountId: accountId || undefined,
        };
      }
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Failed");
        return;
      }
      // Notify both the per-livestock list and the batch detail page.
      globalMutate(
        `/api/livestock-batches?livestockId=${batch.livestockId}&active=false`,
      );
      globalMutate(`/api/livestock-batches/${batch.id}`);
      globalMutate(`/api/livestock-batches/${batch.id}/analytics`);
      globalMutate("/api/livestock");
      await mutateBalances();
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  const showWeight =
    tab === "event" &&
    (eventType === "PURCHASE" || eventType === "SALE");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {tab === "event" ? (
              <span className="inline-flex items-center gap-2">
                <Activity className="h-4 w-4" /> {batch.name} · Event
              </span>
            ) : tab === "feed" ? (
              <span className="inline-flex items-center gap-2">
                <Utensils className="h-4 w-4" /> {batch.name} · Feed
              </span>
            ) : (
              <span className="inline-flex items-center gap-2">
                <Stethoscope className="h-4 w-4" /> {batch.name} · Vaccination
              </span>
            )}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {tab === "event" && (
            <>
              <div className="flex flex-wrap gap-1.5">
                {(["BIRTH", "DEATH", "SALE", "PURCHASE"] as const).map((e) => (
                  <Button
                    key={e}
                    type="button"
                    size="sm"
                    variant={eventType === e ? "default" : "outline"}
                    onClick={() => setEventType(e)}
                  >
                    {e}
                  </Button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Count</Label>
                  <Input
                    inputMode="numeric"
                    value={count}
                    onChange={(e) =>
                      setCount(e.target.value.replace(/\D/g, "").slice(0, 6))
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Date</Label>
                  <DateInput
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </div>
              </div>

              {showWeight && (
                <div className="space-y-2 rounded-xl border bg-muted/30 p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <Label className="text-xs">Pricing</Label>
                    <div className="flex rounded-md border bg-card p-0.5 text-[10px]">
                      {(["per-animal", "per-kg"] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setPricingMode(m)}
                          className={`rounded px-2 py-0.5 transition-colors ${
                            pricingMode === m
                              ? "bg-muted font-medium text-foreground"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {m === "per-animal" ? "Per animal" : "Per kg"}
                        </button>
                      ))}
                    </div>
                  </div>

                  {pricingMode === "per-animal" ? (
                    <>
                      <div className="space-y-1">
                        <Label className="text-[10px]">₹ per animal</Label>
                        <AmountInput
                          value={unitValue}
                          onChange={setUnitValue}
                          placeholder="Per head"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px]">
                          Avg weight per animal (kg, optional)
                        </Label>
                        <Input
                          inputMode="decimal"
                          value={avgWeightKg}
                          onChange={(e) =>
                            setAvgWeightKg(
                              e.target.value.replace(/[^\d.]/g, "").slice(0, 8),
                            )
                          }
                          placeholder="2.10"
                        />
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label className="text-[10px]">Total weight (kg)</Label>
                          <Input
                            inputMode="decimal"
                            value={totalKg}
                            onChange={(e) =>
                              setTotalKg(
                                e.target.value
                                  .replace(/[^\d.]/g, "")
                                  .slice(0, 10),
                              )
                            }
                            placeholder="250.00"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px]">₹ per kg</Label>
                          <AmountInput
                            value={ratePerKg}
                            onChange={setRatePerKg}
                            placeholder="120.00"
                          />
                        </div>
                      </div>
                      {derivedUnitValue != null && derivedAvgWeight != null && (
                        <div className="rounded-md border bg-background px-3 py-2 text-[11px] tabular-nums">
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">
                              Per animal
                            </span>
                            <span className="font-medium">
                              {formatINR(derivedUnitValue)} · {derivedAvgWeight} kg
                            </span>
                          </div>
                          <div className="mt-0.5 flex items-center justify-between border-t pt-1">
                            <span className="text-muted-foreground">Total</span>
                            <span className="font-semibold">
                              {formatINR(totalAmount)}
                            </span>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              <p className="text-[11px] text-muted-foreground">
                Current head: {batch.currentCount}. Birth/Purchase add,
                Death/Sale subtract.
              </p>
            </>
          )}
          {tab === "feed" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Cost (₹)</Label>
                  <AmountInput value={feedAmount} onChange={setFeedAmount} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Date</Label>
                  <DateInput
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">
                    Quantity{" "}
                    <span className="font-normal text-muted-foreground">
                      (drives FCR)
                    </span>
                  </Label>
                  <AmountInput
                    value={feedQuantity}
                    onChange={setFeedQuantity}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Unit</Label>
                  <Input
                    value={feedUnit}
                    onChange={(e) => setFeedUnit(e.target.value)}
                    placeholder="kg, bag, sack…"
                    maxLength={20}
                  />
                </div>
              </div>
            </>
          )}
          {tab === "vaccination" && (
            <>
              <div className="space-y-1">
                <Label className="text-xs">Vaccine</Label>
                <Input
                  value={vaccine}
                  onChange={(e) => setVaccine(e.target.value)}
                  maxLength={80}
                  placeholder="Newcastle, Gumboro, FMD…"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Date</Label>
                  <DateInput
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Next due date</Label>
                  <DateInput
                    value={nextDueDate}
                    onChange={(e) => setNextDueDate(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Cost (₹, optional)</Label>
                <AmountInput
                  value={vaccinationCost}
                  onChange={setVaccinationCost}
                />
              </div>
            </>
          )}

          {isFinancial &&
            (() => {
              const isOutflow =
                (tab === "event" && eventType === "PURCHASE") ||
                tab === "feed" ||
                tab === "vaccination";
              const debitAmount = !isOutflow
                ? 0
                : tab === "feed"
                  ? Number(feedAmount) || 0
                  : tab === "vaccination"
                    ? Number(vaccinationCost) || 0
                    : totalAmount;
              return (
                <div className="space-y-1">
                  <Label className="text-xs inline-flex items-center gap-1">
                    <Wallet className="h-3 w-3" /> Pay from / receive into
                  </Label>
                  <NativeSelect
                    value={accountId}
                    onChange={setAccountId}
                    options={groupAccountOptions(accounts, debitAmount)}
                    searchable
                  />
                </div>
              );
            })()}

          <DescriptionField
            label="Notes"
            value={notes}
            onChange={setNotes}
            placeholder="Optional notes…"
            maxLength={500}
            rows={2}
          />

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
