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

type EstimatedBill = {
  id: string;
  billAmount: number;
  previousReading: number | null;
  currentReading: number | null;
};

/**
 * Confirms the real amount on an auto-generated VARIABLE bill (an
 * "estimated" placeholder). Saving PATCHes the bill — the server clears
 * the `estimated` flag, which makes it eligible for auto-pay / a clean
 * manual pay. For ELECTRICITY we also capture the meter reading.
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

  async function submit() {
    setError(null);
    const amt = Number(amount);
    if (!amt || amt <= 0) return setError("Enter the actual bill amount");
    setSubmitting(true);
    try {
      const res = await fetch(`/api/utility-bills/${bill.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          billAmount: amt,
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
            This bill was auto-created with an estimate. Set the real amount
            so it can be paid.
          </p>
          <div>
            <Label>Bill amount</Label>
            <AmountInput value={amount} onChange={setAmount} placeholder="0" autoFocus />
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
