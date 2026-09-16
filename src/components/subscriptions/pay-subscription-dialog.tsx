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
import { formatINR } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subscription: {
    id: string;
    name: string;
    amount: number;
    nextBillingDate: string;
    accountId: string | null;
    cardId: string | null;
  };
  onPaid: () => void;
};


function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function PaySubscriptionDialog({
  open,
  onOpenChange,
  subscription,
  onPaid,
}: Props) {
  const [amount, setAmount] = useState(String(subscription.amount));
  const [paidOn, setPaidOn] = useState(todayIso());
  // "account:<id>" | "card:<id>" | "" — seeded from the subscription's source.
  const [source, setSource] = useState(() => fundingSourceFromIds(subscription));
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Parent should pass a `key={subscription.id}` and only mount when
  // open — that way useState initializes fresh per session and we avoid
  // a useEffect that resets state on every `open` toggle.

  async function submit() {
    setError(null);
    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setError("Enter a positive amount");
      return;
    }
    setSubmitting(true);
    try {
      const { accountId, cardId } = fundingSourceIds(source);
      const res = await fetch(`/api/subscriptions/${subscription.id}/pay`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amount: amountNum,
          accountId,
          cardId,
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
          <DialogTitle>Pay {subscription.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="rounded-md border bg-muted/30 p-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Due</span>
              <span className="font-medium">
                {new Date(subscription.nextBillingDate).toLocaleDateString("en-IN", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                })}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-muted-foreground">Plan amount</span>
              <span className="font-medium tabular-nums">
                {formatINR(subscription.amount)}
              </span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Amount</Label>
              <AmountInput value={amount} onChange={setAmount} />
            </div>
            <div>
              <Label>Paid on</Label>
              <DateInput value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
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
            {submitting ? "Paying…" : "Confirm pay"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
