"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { AmountInput } from "@/components/ui/amount-input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type EditableTransaction = {
  id: string;
  amount: number;
  date: string; // ISO
  description: string;
};

export function EditTransactionDialog({
  transaction,
  open,
  onOpenChange,
  onSaved,
}: {
  transaction: EditableTransaction | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful PATCH so the caller can refetch / refresh. */
  onSaved?: () => void | Promise<void>;
}) {
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [description, setDescription] = useState("");
  const [editNote, setEditNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed the form whenever a different transaction is loaded.
  const txId = transaction?.id;
  useEffect(() => {
    if (!transaction) return;
    /* eslint-disable react-hooks/set-state-in-effect -- form hydration on dialog open */
    setAmount(String(Math.round(transaction.amount)));
    setDate(transaction.date.slice(0, 10));
    setDescription(transaction.description);
    setEditNote("");
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txId]);

  async function submit() {
    if (!transaction) return;
    setError(null);
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      setError("Enter an amount");
      return;
    }
    if (!description.trim()) {
      setError("Enter a description");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/transactions/${transaction.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amount: amt,
          date,
          description: description.trim(),
          editNote: editNote.trim() || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}) as { error?: string });
      if (!res.ok) {
        setError(body.error ?? "Failed to update");
        return;
      }
      toast.success("Transaction updated");
      await onSaved?.();
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(28rem,calc(100%-2rem))]">
        <DialogHeader>
          <DialogTitle>Edit transaction</DialogTitle>
        </DialogHeader>
        {transaction && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-medium">Amount (₹)</span>
                <AmountInput value={amount} onChange={setAmount} autoFocus />
              </label>
              <label className="block">
                <span className="text-xs font-medium">Date</span>
                <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
            </div>
            <label className="block">
              <span className="text-xs font-medium">Description</span>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={200}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium">
                Edit note <span className="text-muted-foreground">(optional)</span>
              </span>
              <Input
                value={editNote}
                onChange={(e) => setEditNote(e.target.value)}
                maxLength={200}
                placeholder="Why are you editing?"
              />
            </label>
            <p className="text-[11px] text-muted-foreground">
              Linked records — loan outstanding, investment holdings, wage and
              feed logs — are kept in sync automatically.
            </p>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
