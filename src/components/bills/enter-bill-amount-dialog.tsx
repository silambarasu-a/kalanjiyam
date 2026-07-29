"use client";

import { useState } from "react";
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
import { AmountInput } from "@/components/ui/amount-input";
import { DateInput } from "@/components/ui/date-input";

type EstimatedBill = {
  id: string;
  billDate: string;
  billAmount: number;
  periodFrom: string | null;
  periodTo: string | null;
  previousReading: number | null;
  currentReading: number | null;
};

const isoDay = (value: string | null | undefined) =>
  value ? value.slice(0, 10) : "";

/**
 * Confirms the real amount on an auto-generated VARIABLE bill (an
 * "estimated" placeholder). Saving PATCHes the bill — the server clears
 * the `estimated` flag, which makes it eligible for auto-pay / a clean
 * manual pay. For ELECTRICITY we also capture the meter reading.
 *
 * The statement date and service period are editable here because the
 * placeholder was created on a PREDICTED date. When the real bill turns
 * up a fortnight off that prediction — routine for electricity — this is
 * where the guess gets replaced by what the bill actually says, which
 * also re-anchors the provider's next expected bill.
 */
export function EnterBillAmountDialog({
  bill,
  providerKind,
  onOpenChange,
  onSaved,
}: {
  bill: EstimatedBill;
  providerKind: string;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const isElectricity = providerKind === "ELECTRICITY";
  const [amount, setAmount] = useState(
    bill.billAmount > 0 ? String(bill.billAmount) : "",
  );
  const [billDate, setBillDate] = useState(isoDay(bill.billDate));
  const [periodFrom, setPeriodFrom] = useState(isoDay(bill.periodFrom));
  const [periodTo, setPeriodTo] = useState(isoDay(bill.periodTo));
  const [previousReading, setPreviousReading] = useState(
    bill.previousReading != null ? String(bill.previousReading) : "",
  );
  const [currentReading, setCurrentReading] = useState(
    bill.currentReading != null ? String(bill.currentReading) : "",
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const units =
    isElectricity && previousReading !== "" && currentReading !== ""
      ? Math.abs(Number(currentReading) - Number(previousReading))
      : null;

  const periodLength =
    periodFrom && periodTo
      ? Math.round(
          (new Date(`${periodTo}T00:00:00Z`).getTime() -
            new Date(`${periodFrom}T00:00:00Z`).getTime()) /
            86_400_000,
        ) + 1
      : null;

  async function submit() {
    setError(null);
    const amt = Number(amount);
    if (!amt || amt <= 0) return setError("Enter the actual bill amount");
    if (!billDate) return setError("Set the bill's statement date");
    // Both-or-neither, ordered — the server enforces the same rule.
    if (!!periodFrom !== !!periodTo)
      return setError("Set both period dates, or clear both");
    if (periodLength != null && periodLength < 1)
      return setError("The period must end on or after it starts");
    setSubmitting(true);
    try {
      const res = await fetch(`/api/utility-bills/${bill.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          billAmount: amt,
          billDate,
          periodFrom: periodFrom || null,
          periodTo: periodTo || null,
          ...(isElectricity
            ? {
                previousReading:
                  previousReading !== "" ? Number(previousReading) : null,
                currentReading:
                  currentReading !== "" ? Number(currentReading) : null,
              }
            : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Could not save");
        return;
      }
      onSaved();
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Enter the actual amount</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            This bill was auto-created on a predicted date. Set the real
            amount — and correct the dates if the bill says otherwise.
          </p>
          <div>
            <Label>Bill amount</Label>
            <AmountInput value={amount} onChange={setAmount} placeholder="0" autoFocus />
          </div>
          <div>
            <Label>Statement date</Label>
            <DateInput
              value={billDate}
              onChange={(e) => setBillDate(e.target.value)}
            />
          </div>
          <div className="rounded-md border bg-muted/20 p-2.5">
            <div className="flex items-baseline justify-between">
              <Label className="mb-0">Period covered</Label>
              <span className="text-[10px] text-muted-foreground">
                {periodLength != null && periodLength >= 1
                  ? `${periodLength} days`
                  : "—"}
              </span>
            </div>
            <div className="mt-1.5 grid grid-cols-2 gap-3">
              <DateInput
                value={periodFrom}
                onChange={(e) => setPeriodFrom(e.target.value)}
              />
              <DateInput
                value={periodTo}
                onChange={(e) => setPeriodTo(e.target.value)}
              />
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Copy the window from the bill. It drives the ledger
              description and keeps per-month charts comparable when the
              gap between bills isn&rsquo;t even.
            </p>
          </div>
          {isElectricity && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Previous reading</Label>
                <Input
                  inputMode="decimal"
                  value={previousReading}
                  onChange={(e) =>
                    setPreviousReading(e.target.value.replace(/[^\d.]/g, ""))
                  }
                  placeholder="Optional"
                />
              </div>
              <div>
                <Label>Current reading</Label>
                <Input
                  inputMode="decimal"
                  value={currentReading}
                  onChange={(e) =>
                    setCurrentReading(e.target.value.replace(/[^\d.]/g, ""))
                  }
                  placeholder="Optional"
                />
              </div>
              {units != null && (
                <p className="col-span-2 text-[11px] text-emerald-700">
                  {units.toFixed(1)} units consumed
                </p>
              )}
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "Saving…" : "Save amount"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
