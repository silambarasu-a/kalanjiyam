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
import { AmountInput } from "@/components/ui/amount-input";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Label } from "@/components/ui/label";
import { DescriptionField } from "@/components/ui/description-field";
import { fetcher } from "@/lib/swr-fetcher";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: {
    id: string;
    providerName: string;
    accountId: string | null;
    cardId: string | null;
    validUntil: string | null;
    rechargeValidityDays: number | null;
  };
  onSaved: () => void;
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/** Normalise an ISO/date string to a UTC-midnight Date. */
function utcMidnight(iso: string): Date {
  const d = new Date(iso);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Client-side preview of the resulting expiry (the server recomputes this
 * authoritatively). Mirrors `computeRechargeExpiry`: stack onto remaining
 * validity when live and extending, else start from the recharge date.
 */
function previewExpiry(
  paidOnIso: string,
  days: number,
  currentValidUntil: string | null,
  extend: boolean,
): Date {
  const paid = utcMidnight(paidOnIso);
  const current = currentValidUntil ? utcMidnight(currentValidUntil) : null;
  const base = extend && current && current > paid ? current : paid;
  const out = new Date(base);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

function fmt(d: Date): string {
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function RechargeDialog({ open, onOpenChange, provider, onSaved }: Props) {
  const { data: accountsRes } = useSWR<{
    accounts: { id: string; name: string; kind: string }[];
  }>(open ? "/api/accounts" : null, fetcher);
  const { data: cardsRes } = useSWR<{ cards: { id: string; name: string }[] }>(
    open ? "/api/cards" : null,
    fetcher,
  );

  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(todayIso());
  // Validity by number-of-days (default) or an explicit expiry date.
  const [validityMode, setValidityMode] = useState<"days" | "date">("days");
  const [validityDays, setValidityDays] = useState(
    provider.rechargeValidityDays != null
      ? String(provider.rechargeValidityDays)
      : "",
  );
  const [expiryDate, setExpiryDate] = useState("");
  // Whether the current plan is still live (so early-recharge stacking applies).
  const planLive = useMemo(() => {
    if (!provider.validUntil) return false;
    return utcMidnight(provider.validUntil) > utcMidnight(paidOn);
  }, [provider.validUntil, paidOn]);
  const [extendFromCurrent, setExtendFromCurrent] = useState(true);

  const [sourceMode, setSourceMode] = useState<"account" | "card">(
    provider.cardId ? "card" : "account",
  );
  const [accountId, setAccountId] = useState(provider.accountId ?? "");
  const [cardId, setCardId] = useState(provider.cardId ?? "");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const daysNum = Number(validityDays);
  const preview =
    validityMode === "days" && Number.isFinite(daysNum) && daysNum > 0
      ? previewExpiry(paidOn, daysNum, provider.validUntil, planLive && extendFromCurrent)
      : validityMode === "date" && expiryDate
        ? utcMidnight(expiryDate)
        : null;

  async function submit() {
    setError(null);
    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0)
      return setError("Enter a positive amount");
    if (validityMode === "days" && (!Number.isFinite(daysNum) || daysNum <= 0))
      return setError("Enter the plan validity in days");
    if (validityMode === "date" && !expiryDate)
      return setError("Pick the plan's expiry date");
    if (sourceMode === "account" && !accountId) return setError("Pick an account");
    if (sourceMode === "card" && !cardId) return setError("Pick a card");
    setSubmitting(true);
    try {
      const res = await fetch(`/api/utility-providers/${provider.id}/recharge`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amount: amountNum,
          validityDays: validityMode === "days" ? daysNum : null,
          validUntil: validityMode === "date" ? expiryDate : null,
          extendFromCurrent: planLive && extendFromCurrent,
          accountId: sourceMode === "account" ? accountId : null,
          cardId: sourceMode === "card" ? cardId : null,
          paidOn,
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
          <DialogTitle>Recharge {provider.providerName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-xs text-muted-foreground">
            Records the payment as an EXPENSE transaction and extends the
            plan&rsquo;s validity. You&rsquo;ll be reminded before it expires.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Amount</Label>
              <AmountInput value={amount} onChange={setAmount} />
            </div>
            <div>
              <Label>Recharged on</Label>
              <DateInput value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2 rounded-md border bg-muted/30 p-3">
            <div className="text-xs font-medium">Validity</div>
            <div className="flex gap-2 text-xs">
              {(
                [
                  ["days", "By days"],
                  ["date", "By expiry date"],
                ] as const
              ).map(([m, lbl]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setValidityMode(m)}
                  className={`rounded-md border px-3 py-1.5 ${
                    validityMode === m
                      ? "bg-foreground text-background"
                      : "bg-background"
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>
            {validityMode === "days" ? (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">Valid for</span>
                <Input
                  value={validityDays}
                  onChange={(e) =>
                    setValidityDays(e.target.value.replace(/\D/g, "").slice(0, 4))
                  }
                  className="h-8 w-16 text-center"
                  placeholder="30"
                />
                <span className="text-muted-foreground">days</span>
              </div>
            ) : (
              <DateInput
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
              />
            )}
            {validityMode === "days" && planLive && (
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={extendFromCurrent}
                  onChange={(e) => setExtendFromCurrent(e.target.checked)}
                />
                Add onto remaining validity (current plan is still active)
              </label>
            )}
            {preview && (
              <p className="text-xs text-muted-foreground">
                New validity until{" "}
                <span className="font-medium text-foreground">{fmt(preview)}</span>
              </p>
            )}
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
            placeholder="Optional — e.g. plan name"
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "Recharging…" : "Record recharge"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
