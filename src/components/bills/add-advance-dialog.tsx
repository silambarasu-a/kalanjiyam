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
import { AmountInput } from "@/components/ui/amount-input";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import { DescriptionField } from "@/components/ui/description-field";
import { FundingSourcePicker } from "@/components/shared/funding-source-picker";
import { fundingSourceFromIds, fundingSourceIds } from "@/lib/funding-sources";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: { id: string; providerName: string; accountId: string | null; cardId: string | null };
  onSaved: () => void;
};


function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function AddAdvanceDialog({ open, onOpenChange, provider, onSaved }: Props) {
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayIso());
  // "account:<id>" | "card:<id>" | "" — seeded from the provider's default.
  const [source, setSource] = useState(() => fundingSourceFromIds(provider));
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Parent should pass a stable `key` (e.g. provider.id) and mount the
  // dialog conditionally so state initializes fresh per session.

  async function submit() {
    setError(null);
    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0)
      return setError("Enter a positive amount");
    const { accountId, cardId } = fundingSourceIds(source);
    if (!accountId && !cardId) return setError("Pick an account or card");
    setSubmitting(true);
    try {
      const res = await fetch(`/api/utility-providers/${provider.id}/advance`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amount: amountNum,
          date,
          accountId,
          cardId,
          notes: notes.trim() || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Failed");
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
          <DialogTitle>Add advance to {provider.providerName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-xs text-muted-foreground">
            Future bills will pull from this advance first. The amount is
            recorded as an EXPENSE transaction and added to the provider&rsquo;s
            advance balance.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Amount</Label>
              <AmountInput value={amount} onChange={setAmount} />
            </div>
            <div>
              <Label>Date</Label>
              <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2 rounded-md border bg-muted/30 p-3">
            <div className="text-xs font-medium">Paid from</div>
            <FundingSourcePicker
              value={source}
              onChange={setSource}
              enabled={open}
              amount={Number(amount) || 0}
            />
          </div>
          <DescriptionField
            value={notes}
            onChange={setNotes}
            label="Notes"
            maxLength={200}
            placeholder="Optional"
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "Adding…" : "Add advance"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
