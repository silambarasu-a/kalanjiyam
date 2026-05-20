"use client";

import { useState } from "react";
import useSWR from "swr";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { DateInput } from "@/components/ui/date-input";
import { DescriptionField } from "@/components/ui/description-field";
import { formatINR } from "@/lib/utils";
import { fetcher } from "@/lib/swr-fetcher";

type Analytics = {
  daysInCycle: number;
  liveHead: number;
  totalFeedKg: number;
  totalFeedSpend: number;
  liveWeightGainKg: number;
  latestAvgKg: number | null;
  fcr: number | null;
  adgGrams: number | null;
  totalDeaths: number;
  mortalityPct: number;
  contractPayout: {
    liftedWeightKg: number;
    basePayout: number;
    fcrBonusAmount: number;
    mortalityPenaltyAmount: number;
    expectedPayout: number;
  } | null;
};

/**
 * Close-batch flow with a cycle-summary recap. Confirms final FCR /
 * mortality / payout before flipping `active=false` + setting endDate.
 * Re-opens the batch later (set active=true via the edit form) preserves
 * everything; the recap here is purely informational at close-time.
 */
export function CloseBatchDialog({
  open,
  onOpenChange,
  batchId,
  batchName,
  isContract,
  netPnL,
  onClosed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batchId: string;
  batchName: string;
  isContract: boolean;
  netPnL: number;
  onClosed: () => void;
}) {
  const { data: analyticsRes } = useSWR<{ analytics: Analytics }>(
    open ? `/api/livestock-batches/${batchId}/analytics` : null,
    fetcher,
  );
  const analytics = analyticsRes?.analytics;
  const [endDate, setEndDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/livestock-batches/${batchId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          active: false,
          endDate,
          notes: notes.trim()
            ? `${notes.trim()}\n— closed ${endDate}`
            : undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Failed to close");
        return;
      }
      onOpenChange(false);
      onClosed();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Close batch · {batchName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Closing the batch locks it from new entries (you can still
            view and edit history). Re-open by editing the batch and
            flipping it back to active.
          </p>

          {analytics ? (
            <div className="rounded-xl border bg-muted/30 p-3">
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Cycle summary
              </h3>
              <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                <SummaryRow
                  label="Days in cycle"
                  value={`${analytics.daysInCycle}`}
                />
                <SummaryRow
                  label="Live head"
                  value={`${analytics.liveHead}`}
                />
                <SummaryRow
                  label="Deaths"
                  value={`${analytics.totalDeaths}`}
                />
                <SummaryRow
                  label="Mortality"
                  value={`${analytics.mortalityPct.toFixed(1)}%`}
                  tone={analytics.mortalityPct > 5 ? "warn" : "neutral"}
                />
                {analytics.fcr != null && (
                  <SummaryRow
                    label="Final FCR"
                    value={analytics.fcr.toFixed(2)}
                  />
                )}
                {analytics.adgGrams != null && (
                  <SummaryRow
                    label="ADG"
                    value={`${analytics.adgGrams.toFixed(0)} g/day`}
                  />
                )}
                <SummaryRow
                  label="Feed spend"
                  value={formatINR(analytics.totalFeedSpend)}
                />
                {analytics.totalFeedKg > 0 && (
                  <SummaryRow
                    label="Feed used"
                    value={`${analytics.totalFeedKg.toFixed(1)} kg`}
                  />
                )}
              </ul>
              {isContract && analytics.contractPayout ? (
                <div className="mt-3 border-t pt-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Expected payout
                    </span>
                    <span className="text-base font-semibold tabular-nums">
                      {formatINR(analytics.contractPayout.expectedPayout)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {analytics.contractPayout.liftedWeightKg.toFixed(0)} kg lifted ·{" "}
                    {formatINR(analytics.contractPayout.basePayout)} base
                    {analytics.contractPayout.fcrBonusAmount > 0
                      ? ` · +${formatINR(analytics.contractPayout.fcrBonusAmount)} bonus`
                      : ""}
                    {analytics.contractPayout.mortalityPenaltyAmount > 0
                      ? ` · −${formatINR(analytics.contractPayout.mortalityPenaltyAmount)} penalty`
                      : ""}
                  </p>
                </div>
              ) : (
                <div className="mt-3 border-t pt-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {netPnL >= 0 ? "Net P&L" : "Net loss"}
                    </span>
                    <span
                      className={`text-base font-semibold tabular-nums ${
                        netPnL < 0 ? "text-destructive" : ""
                      }`}
                    >
                      {formatINR(Math.abs(netPnL))}
                    </span>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-md border bg-muted/30 p-3 text-[11px] text-muted-foreground">
              Loading cycle summary…
            </div>
          )}

          {analytics && analytics.liveHead > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-[11px] dark:border-amber-900 dark:bg-amber-950/40">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
              <span>
                <strong>{analytics.liveHead}</strong> animals are still
                live. If they were sold or lifted, record the SALE event
                first so the books match the field.
              </span>
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-xs">End date</Label>
            <DateInput
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>

          <DescriptionField
            label="Closing notes"
            value={notes}
            onChange={setNotes}
            placeholder="What happened, lessons learned, anything for the next cycle…"
            maxLength={500}
            rows={3}
          />

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting} className="gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {submitting ? "Closing…" : "Close batch"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SummaryRow({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "warn";
}) {
  return (
    <li className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={`tabular-nums font-medium ${
          tone === "warn" ? "text-amber-700 dark:text-amber-400" : ""
        }`}
      >
        {value}
      </span>
    </li>
  );
}
