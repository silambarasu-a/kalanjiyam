"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { AmountInput } from "@/components/ui/amount-input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { mutateBalances } from "@/lib/mutate-balances";
import { formatINR, groupAccountOptions } from "@/lib/utils";

type Account = {
  id: string;
  name: string;
  kind: string;
  balance: number;
  availableLimit: number | null;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

/**
 * Focused dialog for paying down a credit-card bill. Source = any non-card
 * account; destination is fixed to the card's companion account so the
 * transfer auto-tags to the matching CardStatement (or — for manual
 * overrides without a materialised statement — counts as an untagged
 * payment that the dashboard / notifications net out via
 * untaggedPaymentsToCard).
 */
export function PayBillDialog({
  open,
  onClose,
  cardName,
  toAccountId,
  outstanding,
  dueDate,
  contextLabel,
}: {
  open: boolean;
  onClose: () => void;
  cardName: string;
  toAccountId: string;
  outstanding: number;
  dueDate?: string | null;
  contextLabel?: string | null;
}) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const { data: accountsData } = useSWR<{ accounts: Account[] }>(
    open ? "/api/accounts" : null,
    fetcher,
  );
  const sources = (accountsData?.accounts ?? []).filter(
    (a) => a.kind !== "CARD" && a.id !== toAccountId,
  );

  const [fromAccountId, setFromAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- reset on open */
    setFromAccountId("");
    setAmount(outstanding > 0 ? String(outstanding) : "");
    setDate(today);
    setNotes(
      contextLabel ? `Bill payment · ${contextLabel}` : `Bill payment · ${cardName}`,
    );
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, outstanding, today, contextLabel, cardName]);

  async function submit() {
    setError(null);
    if (!fromAccountId) return setError("Pick the account to pay from.");
    const amt = Number(amount);
    if (!amt || amt <= 0) return setError("Enter a payment amount.");
    setSubmitting(true);
    try {
      const res = await fetch("/api/transfers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fromAccountId,
          toAccountId,
          amount: amt,
          date,
          notes: notes.trim() || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Failed");
        return;
      }
      toast.success(
        amt >= outstanding
          ? "Bill paid in full"
          : `Paid ${formatINR(amt)} · ${formatINR(outstanding - amt)} remaining`,
      );
      await mutateBalances();
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pay {cardName} bill</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {contextLabel ? `${contextLabel} · ` : ""}
            <span className="font-medium text-foreground tabular-nums">
              {formatINR(outstanding)} due
            </span>
            {dueDate ? ` by ${new Date(dueDate).toLocaleDateString("en-IN")}` : ""}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium">Amount (₹)</span>
              <AmountInput value={amount} onChange={setAmount} autoFocus />
              {outstanding > 0 && Number(amount) > 0 && Number(amount) < outstanding && (
                <span className="mt-1 block text-[11px] text-muted-foreground">
                  Partial · {formatINR(outstanding - Number(amount))} will remain
                </span>
              )}
            </label>
            <label className="block">
              <span className="text-xs font-medium">Date</span>
              <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium">Pay from</span>
            <div className="mt-1">
              <NativeSelect
                value={fromAccountId}
                onChange={setFromAccountId}
                options={groupAccountOptions(sources, Number(amount) || 0)}
              />
            </div>
          </label>
          <label className="block">
            <span className="text-xs font-medium">Notes</span>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={200}
            />
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "Paying…" : "Pay"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
