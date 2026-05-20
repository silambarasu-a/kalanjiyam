"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { Truck } from "lucide-react";
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
import { NativeSelect } from "@/components/ui/native-select";
import { DescriptionField } from "@/components/ui/description-field";
import { formatINR, groupAccountOptions } from "@/lib/utils";
import { fetcher } from "@/lib/swr-fetcher";

type Account = {
  id: string;
  name: string;
  kind: string;
  balance: number;
  availableLimit: number | null;
};

type Analytics = {
  liveHead: number;
  fcr: number | null;
  mortalityPct: number;
  contractPayout: {
    liftedWeightKg: number;
    basePayout: number;
    fcrBonusPerKg: number;
    fcrBonusAmount: number;
    mortalityPenaltyPerKg: number;
    mortalityPenaltyAmount: number;
    expectedPayout: number;
  } | null;
};

/**
 * Broiler-contract lift flow. Pre-fills count from the live head and
 * total weight from `liveHead × latestAvgKg` so the farmer mostly just
 * needs to confirm. Live payout preview updates as they tweak weight.
 */
export function RecordLiftDialog({
  open,
  onOpenChange,
  batchId,
  liveHead,
  latestAvgKg,
  agreedRatePerKg,
  integratorName,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batchId: string;
  liveHead: number;
  latestAvgKg: number | null;
  agreedRatePerKg: number;
  integratorName: string;
  onSaved: () => void;
}) {
  const { data: accountsRes } = useSWR<{ accounts: Account[] }>(
    open ? "/api/accounts" : null,
    fetcher,
  );
  const accounts = useMemo(
    () => (accountsRes?.accounts ?? []).filter((a) => a.kind !== "CARD"),
    [accountsRes],
  );

  const [date, setDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [count, setCount] = useState(String(liveHead));
  const [totalWeightKg, setTotalWeightKg] = useState(
    latestAvgKg != null && liveHead > 0
      ? (latestAvgKg * liveHead).toFixed(2)
      : "",
  );
  const [accountId, setAccountId] = useState("");
  const [closeBatch, setCloseBatch] = useState(true);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-prime defaults each time the dialog opens — the live head /
  // latest weight may have changed since the last open.
  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- reset on open */
    setDate(new Date().toISOString().slice(0, 10));
    setCount(String(liveHead));
    setTotalWeightKg(
      latestAvgKg != null && liveHead > 0
        ? (latestAvgKg * liveHead).toFixed(2)
        : "",
    );
    setAccountId("");
    setCloseBatch(true);
    setNotes("");
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, liveHead, latestAvgKg]);

  // Live preview — recompute base + (proportional) payout estimate.
  // The server still re-runs the full math (FCR bonus + penalty) on
  // submit; this preview just shows the base figure so the farmer can
  // sanity-check before pressing the button.
  const previewBase =
    Number(totalWeightKg) > 0
      ? +(Number(totalWeightKg) * agreedRatePerKg).toFixed(2)
      : 0;
  const avgPerBird =
    Number(count) > 0 && Number(totalWeightKg) > 0
      ? +(Number(totalWeightKg) / Number(count)).toFixed(3)
      : null;

  // Fetch the analytics endpoint when open so we can show the precise
  // FCR-bonus / mortality-penalty estimate before the user commits.
  const { data: analyticsRes } = useSWR<{ analytics: Analytics }>(
    open ? `/api/livestock-batches/${batchId}/analytics` : null,
    fetcher,
  );
  const fcr = analyticsRes?.analytics.fcr ?? null;
  const mortalityPct = analyticsRes?.analytics.mortalityPct ?? 0;

  async function submit() {
    setError(null);
    const c = Number(count);
    const w = Number(totalWeightKg);
    if (!Number.isFinite(c) || c <= 0)
      return setError("Count must be at least 1");
    if (c > liveHead)
      return setError(`Only ${liveHead} live birds in this batch`);
    if (!Number.isFinite(w) || w <= 0)
      return setError("Total weight must be positive");
    if (!accountId) return setError("Pick the account that receives the payout");
    setSubmitting(true);
    try {
      const res = await fetch(`/api/livestock-batches/${batchId}/lift`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          date,
          count: c,
          totalWeightKg: w,
          accountId,
          closeBatch,
          notes: notes.trim() || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Failed to record lift");
        return;
      }
      onOpenChange(false);
      onSaved();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Truck className="h-4 w-4" /> Record lift · {integratorName}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-[11px] text-muted-foreground">
            Books the integrator pickup: creates an EXIT weighing, a SALE
            event, and an INCOME transaction for the growing-charge cheque.
            Final payout includes any FCR bonus + mortality penalty.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Lift date</Label>
              <DateInput
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Birds lifted</Label>
              <Input
                inputMode="numeric"
                value={count}
                onChange={(e) =>
                  setCount(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                placeholder={String(liveHead)}
              />
              <p className="text-[10px] text-muted-foreground">
                {liveHead} live in the batch
              </p>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Total lifted weight (kg)</Label>
            <Input
              inputMode="decimal"
              value={totalWeightKg}
              onChange={(e) =>
                setTotalWeightKg(
                  e.target.value.replace(/[^\d.]/g, "").slice(0, 10),
                )
              }
              placeholder={
                latestAvgKg != null && liveHead > 0
                  ? (latestAvgKg * liveHead).toFixed(2)
                  : ""
              }
            />
            {avgPerBird && (
              <p className="text-[10px] text-muted-foreground">
                Avg per bird {avgPerBird} kg
              </p>
            )}
          </div>

          <div className="rounded-xl border bg-muted/30 p-3">
            <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Payout preview
            </h3>
            <ul className="space-y-1 text-xs">
              <PayoutLine
                label={`Base (${Number(totalWeightKg).toFixed(0) || 0} kg × ₹${agreedRatePerKg.toFixed(2)})`}
                value={formatINR(previewBase)}
              />
              {analyticsRes?.analytics.contractPayout?.fcrBonusPerKg != null &&
                analyticsRes.analytics.contractPayout.fcrBonusPerKg > 0 && (
                  <PayoutLine
                    label={`+ FCR bonus (₹${analyticsRes.analytics.contractPayout.fcrBonusPerKg.toFixed(2)}/kg)`}
                    value={`+${formatINR(
                      +(
                        Number(totalWeightKg) *
                        analyticsRes.analytics.contractPayout.fcrBonusPerKg
                      ).toFixed(2),
                    )}`}
                    tone="positive"
                  />
                )}
              {analyticsRes?.analytics.contractPayout?.mortalityPenaltyPerKg !=
                null &&
                analyticsRes.analytics.contractPayout
                  .mortalityPenaltyPerKg > 0 && (
                  <PayoutLine
                    label={`− Mortality penalty (₹${analyticsRes.analytics.contractPayout.mortalityPenaltyPerKg.toFixed(2)}/kg)`}
                    value={`−${formatINR(
                      +(
                        Number(totalWeightKg) *
                        analyticsRes.analytics.contractPayout
                          .mortalityPenaltyPerKg
                      ).toFixed(2),
                    )}`}
                    tone="negative"
                  />
                )}
            </ul>
            {(fcr != null || mortalityPct > 0) && (
              <p className="mt-2 text-[10px] text-muted-foreground">
                Current FCR {fcr != null ? fcr.toFixed(2) : "—"} · mortality{" "}
                {mortalityPct.toFixed(2)}%
              </p>
            )}
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Receive payout into</Label>
            <NativeSelect
              value={accountId}
              onChange={setAccountId}
              options={groupAccountOptions(accounts, 0)}
              searchable
              placeholder="— pick account —"
            />
          </div>

          <label className="flex items-start gap-2 rounded-md border bg-muted/30 p-2.5 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={closeBatch}
              onChange={(e) => setCloseBatch(e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 accent-primary"
            />
            <span>
              <span className="font-medium">Close batch after lift</span>
              <span className="ml-1 text-muted-foreground">
                — recommended when the whole flock leaves. Untick if this
                is a partial pickup.
              </span>
            </span>
          </label>

          <DescriptionField
            label="Notes"
            value={notes}
            onChange={setNotes}
            placeholder="Truck number, supervisor, any condition adjustments…"
            maxLength={500}
            rows={2}
          />

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting} className="gap-1.5">
            <Truck className="h-3.5 w-3.5" />
            {submitting ? "Recording…" : "Record lift"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PayoutLine({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "positive" | "negative";
}) {
  return (
    <li className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={`tabular-nums font-medium ${
          tone === "positive"
            ? "text-emerald-700 dark:text-emerald-400"
            : tone === "negative"
              ? "text-destructive"
              : ""
        }`}
      >
        {value}
      </span>
    </li>
  );
}
