"use client";

import { useState } from "react";
import useSWR from "swr";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AmountInput } from "@/components/ui/amount-input";
import { DateInput } from "@/components/ui/date-input";
import { NativeSelect } from "@/components/ui/native-select";
import { Label } from "@/components/ui/label";
import { formatINR } from "@/lib/utils";
import { fetcher } from "@/lib/swr-fetcher";

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
  const { data: accountsRes } = useSWR<{
    accounts: { id: string; name: string; kind: string }[];
  }>(open ? "/api/accounts" : null, fetcher);
  const { data: cardsRes } = useSWR<{ cards: { id: string; name: string }[] }>(
    open ? "/api/cards" : null,
    fetcher,
  );

  const [amount, setAmount] = useState(String(subscription.amount));
  const [paidOn, setPaidOn] = useState(todayIso());
  const [sourceMode, setSourceMode] = useState<"account" | "card">(
    subscription.cardId ? "card" : "account",
  );
  const [accountId, setAccountId] = useState(subscription.accountId ?? "");
  const [cardId, setCardId] = useState(subscription.cardId ?? "");
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
      const res = await fetch(`/api/subscriptions/${subscription.id}/pay`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amount: amountNum,
          accountId: sourceMode === "account" ? accountId || null : null,
          cardId: sourceMode === "card" ? cardId || null : null,
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
            <div className="flex gap-2 text-xs">
              <button
                type="button"
                onClick={() => setSourceMode("account")}
                className={`rounded-md border px-3 py-1.5 ${
                  sourceMode === "account"
                    ? "bg-foreground text-background"
                    : "bg-background"
                }`}
              >
                Account
              </button>
              <button
                type="button"
                onClick={() => setSourceMode("card")}
                className={`rounded-md border px-3 py-1.5 ${
                  sourceMode === "card"
                    ? "bg-foreground text-background"
                    : "bg-background"
                }`}
              >
                Card
              </button>
            </div>
            {sourceMode === "account" ? (
              <NativeSelect
                value={accountId}
                onChange={setAccountId}
                options={(accountsRes?.accounts ?? []).map((a) => ({
                  value: a.id,
                  label: a.name,
                  hint: a.kind,
                }))}
                placeholder="Select account"
              />
            ) : (
              <NativeSelect
                value={cardId}
                onChange={setCardId}
                options={(cardsRes?.cards ?? []).map((c) => ({
                  value: c.id,
                  label: c.name,
                }))}
                placeholder="Select card"
              />
            )}
          </div>
          <div>
            <Label>Notes</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={200}
              placeholder="Optional"
            />
          </div>
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
