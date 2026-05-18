"use client";

import { useMemo, useState } from "react";
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
import { DateInput } from "@/components/ui/date-input";
import { NativeSelect } from "@/components/ui/native-select";
import { Label } from "@/components/ui/label";
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

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function PayBillDialog({ open, onOpenChange, bill, onPaid }: Props) {
  const { data: accountsRes } = useSWR<{
    accounts: { id: string; name: string; kind: string }[];
  }>(open ? "/api/accounts" : null, fetcher);
  const { data: cardsRes } = useSWR<{ cards: { id: string; name: string }[] }>(
    open ? "/api/cards" : null,
    fetcher,
  );

  const maxAdvance = useMemo(
    () => Math.min(bill.provider.advanceBalance, bill.billAmount),
    [bill.billAmount, bill.provider.advanceBalance],
  );

  const [advance, setAdvance] = useState(maxAdvance);
  const [paidOn, setPaidOn] = useState(todayIso());
  const [sourceMode, setSourceMode] = useState<"account" | "card">(
    bill.provider.cardId ? "card" : "account",
  );
  const [accountId, setAccountId] = useState(bill.provider.accountId ?? "");
  const [cardId, setCardId] = useState(bill.provider.cardId ?? "");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Parent uses `{bill && <PayBillDialog ... />}` so this remounts per
  // bill — state initializes fresh, no reset effect needed.

  const cashAmount = Math.max(0, +(bill.billAmount - advance).toFixed(2));

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/utility-bills/${bill.id}/pay`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          advanceApplied: advance,
          accountId: cashAmount > 0 && sourceMode === "account" ? accountId : null,
          cardId: cashAmount > 0 && sourceMode === "card" ? cardId : null,
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
                + Source ({sourceMode === "card" ? "card" : "account"})
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
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Paid on</Label>
              <DateInput value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
            </div>
            <div>
              <Label>Notes</Label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={200}
              />
            </div>
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
