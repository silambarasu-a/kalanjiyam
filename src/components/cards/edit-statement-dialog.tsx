"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AmountInput } from "@/components/ui/amount-input";
import { DateInput } from "@/components/ui/date-input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { mutateBalances } from "@/lib/mutate-balances";

function toDateInputValue(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Trigger + dialog for hand-correcting a materialised CardStatement's bill
 * amount and due date. Used to capture late fees, taxes, EMI installments,
 * etc. that the bank charged but that aren't reflected in the transaction
 * history. Edits only the snapshot — does NOT touch transactions or the
 * live card balance.
 */
export function EditStatementButton({
  cardId,
  statementId,
  currentTotalDue,
  currentDueDate,
  periodLabel,
}: {
  cardId: string;
  statementId: string;
  currentTotalDue: number;
  currentDueDate: string;
  periodLabel: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(currentTotalDue));
  const [dueDate, setDueDate] = useState(toDateInputValue(currentDueDate));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- reset on open */
    setAmount(String(currentTotalDue));
    setDueDate(toDateInputValue(currentDueDate));
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, currentTotalDue, currentDueDate]);

  async function submit() {
    setError(null);
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt < 0) {
      return setError("Enter a valid amount.");
    }
    if (!dueDate) {
      return setError("Pick a due date.");
    }
    const body: { totalDue?: number; dueDate?: string } = {};
    if (amt !== currentTotalDue) body.totalDue = amt;
    if (dueDate !== toDateInputValue(currentDueDate)) body.dueDate = dueDate;
    if (body.totalDue === undefined && body.dueDate === undefined) {
      setOpen(false);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/cards/${cardId}/statements/${statementId}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed");
        return;
      }
      toast.success("Statement updated");
      await mutateBalances();
      router.refresh();
      setOpen(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        size="sm"
        variant="ghost"
        className="gap-1.5"
      >
        <Pencil className="h-3.5 w-3.5" /> Edit
      </Button>
      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit statement</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">{periodLabel}</p>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-medium">Due amount (₹)</span>
                <AmountInput value={amount} onChange={setAmount} autoFocus />
              </label>
              <label className="block">
                <span className="text-xs font-medium">Due date</span>
                <DateInput
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </label>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Adjusts the bill snapshot only. Card balance and transactions
              are unchanged.
            </p>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button onClick={submit} disabled={submitting}>
              {submitting ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
