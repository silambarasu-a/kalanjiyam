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
import { AmountInput } from "@/components/ui/amount-input";
import { DateInput } from "@/components/ui/date-input";
import { NativeSelect } from "@/components/ui/native-select";
import { Label } from "@/components/ui/label";
import { DescriptionField } from "@/components/ui/description-field";
import { fetcher } from "@/lib/swr-fetcher";

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
  const { data: accountsRes } = useSWR<{
    accounts: { id: string; name: string; kind: string }[];
  }>(open ? "/api/accounts" : null, fetcher);
  const { data: cardsRes } = useSWR<{ cards: { id: string; name: string }[] }>(
    open ? "/api/cards" : null,
    fetcher,
  );
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayIso());
  const [sourceMode, setSourceMode] = useState<"account" | "card">(
    provider.cardId ? "card" : "account",
  );
  const [accountId, setAccountId] = useState(provider.accountId ?? "");
  const [cardId, setCardId] = useState(provider.cardId ?? "");
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
    if (sourceMode === "account" && !accountId) return setError("Pick an account");
    if (sourceMode === "card" && !cardId) return setError("Pick a card");
    setSubmitting(true);
    try {
      const res = await fetch(`/api/utility-providers/${provider.id}/advance`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amount: amountNum,
          date,
          accountId: sourceMode === "account" ? accountId : null,
          cardId: sourceMode === "card" ? cardId : null,
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
