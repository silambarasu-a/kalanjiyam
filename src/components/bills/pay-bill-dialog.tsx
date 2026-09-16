"use client";

import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import { DescriptionField } from "@/components/ui/description-field";
import { FundingSourcePicker } from "@/components/shared/funding-source-picker";
import { fundingSourceFromIds, fundingSourceIds } from "@/lib/funding-sources";
import { formatINR } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bill: {
    id: string;
    billAmount: number;
    dueDate: string;
    provider: {
      id: string;
      providerName: string;
      advanceBalance: number;
      accountId: string | null;
      cardId: string | null;
    };
  };
  onPaid: () => void;
};


function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function PayBillDialog({ open, onOpenChange, bill, onPaid }: Props) {
  const maxAdvance = useMemo(
    () => Math.min(bill.provider.advanceBalance, bill.billAmount),
    [bill.billAmount, bill.provider.advanceBalance],
  );

  const [advance, setAdvance] = useState(maxAdvance);
  const [paidOn, setPaidOn] = useState(todayIso());
  // "account:<id>" | "card:<id>" | "" — seeded from the provider's default.
  const [source, setSource] = useState(() => fundingSourceFromIds(bill.provider));
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Parent uses `{bill && <PayBillDialog ... />}` so this remounts per
  // bill — state initializes fresh, no reset effect needed.

  const cashAmount = Math.max(0, +(bill.billAmount - advance).toFixed(2));
  const sourceIds = fundingSourceIds(source);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/utility-bills/${bill.id}/pay`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          advanceApplied: advance,
          accountId: cashAmount > 0 ? sourceIds.accountId : null,
          cardId: cashAmount > 0 ? sourceIds.cardId : null,
          paidOn,
          notes: notes.trim() || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Pay failed");
        return;
      }
      onOpenChange(false);
      onPaid();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Pay {bill.provider.providerName} bill</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div className="rounded-md border bg-muted/30 p-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Bill amount</span>
              <span className="font-semibold tabular-nums">
                {formatINR(bill.billAmount)}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-muted-foreground">Advance available</span>
              <span className="tabular-nums">
                {formatINR(bill.provider.advanceBalance)}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-muted-foreground">Due</span>
              <span>
                {new Date(bill.dueDate).toLocaleDateString("en-IN", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                })}
              </span>
            </div>
          </div>

          {bill.provider.advanceBalance > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <Label className="m-0">Apply from advance</Label>
                <span className="font-semibold tabular-nums">
                  {formatINR(advance)}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={maxAdvance}
                step={1}
                value={advance}
                onChange={(e) => setAdvance(Number(e.target.value))}
                className="w-full accent-foreground"
              />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>₹0</span>
                <span>Max {formatINR(maxAdvance)}</span>
              </div>
            </div>
          )}

          <div className="rounded-md border bg-card p-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Advance applied</span>
              <span className="font-medium tabular-nums">
                {formatINR(advance)}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-muted-foreground">
                + Source ({sourceIds.cardId ? "card" : "account"})
              </span>
              <span className="font-medium tabular-nums">
                {formatINR(cashAmount)}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between border-t pt-2">
              <span className="font-medium">= Bill total</span>
              <span className="font-semibold tabular-nums">
                {formatINR(bill.billAmount)}
              </span>
            </div>
          </div>

          {cashAmount > 0 && (
            <div className="space-y-2 rounded-md border bg-muted/30 p-3">
              <div className="text-xs font-medium">
                Pay cash portion from
              </div>
              <FundingSourcePicker
                value={source}
                onChange={setSource}
                enabled={open}
                amount={cashAmount}
              />
            </div>
          )}

          <div>
            <Label>Paid on</Label>
            <DateInput value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
          </div>
          <DescriptionField
            value={notes}
            onChange={setNotes}
            label="Notes"
            maxLength={200}
          />

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "Paying…" : "Confirm pay"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
