"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
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
import { AttachmentList } from "@/components/attachments/attachment-list";

export type EditableTransaction = {
  id: string;
  amount: number;
  date: string; // ISO
  description: string;
  eventId?: string | null;
  // Fuel-fill fields — only surfaced when the row has any of them set.
  // Caller (transactions list) populates from the API response so
  // edits round-trip correctly for fuel transactions.
  fuelQuantity?: number | null;
  fuelUnit?: string | null;
  fuelOdometer?: number | null;
};

type EventLite = {
  id: string;
  name: string;
  kind: string;
  startedAt: string;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

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
  const [eventId, setEventId] = useState<string>("");
  const [fuelQuantity, setFuelQuantity] = useState("");
  const [fuelOdometer, setFuelOdometer] = useState("");
  const [editNote, setEditNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch events only while the dialog is open to avoid the round-trip
  // on every transaction list render.
  const { data: eventsData } = useSWR<{ events: EventLite[] }>(
    open ? "/api/events?status=all" : null,
    fetcher,
  );
  const events = eventsData?.events ?? [];

  // Re-seed the form whenever a different transaction is loaded.
  const txId = transaction?.id;
  useEffect(() => {
    if (!transaction) return;
    /* eslint-disable react-hooks/set-state-in-effect -- form hydration on dialog open */
    setAmount(String(Math.round(transaction.amount)));
    setDate(transaction.date.slice(0, 10));
    setDescription(transaction.description);
    setEventId(transaction.eventId ?? "");
    setFuelQuantity(
      transaction.fuelQuantity != null ? String(transaction.fuelQuantity) : "",
    );
    setFuelOdometer(
      transaction.fuelOdometer != null ? String(transaction.fuelOdometer) : "",
    );
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
      // Only echo fuel fields back when this transaction had them to
      // begin with — otherwise we'd silently null out the columns on
      // every edit of an unrelated transaction. PATCH treats `undefined`
      // as "no change", so omitting the key entirely is the safe path.
      const hadFuel =
        transaction.fuelQuantity != null ||
        transaction.fuelOdometer != null ||
        transaction.fuelUnit != null;
      const res = await fetch(`/api/transactions/${transaction.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amount: amt,
          date,
          description: description.trim(),
          eventId: eventId || null,
          ...(hadFuel
            ? {
                fuelQuantity: fuelQuantity ? Number(fuelQuantity) : null,
                fuelOdometer: fuelOdometer ? Number(fuelOdometer) : null,
                // Keep the original unit; we don't surface a unit
                // picker in this dialog. Leave it as-is by omitting it.
              }
            : {}),
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
            {(transaction.fuelQuantity != null ||
              transaction.fuelOdometer != null) && (
              <div className="rounded-md border bg-muted/30 p-3 space-y-2">
                <div className="text-xs font-medium">Fuel fill</div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-[10px] font-medium">
                      Quantity{" "}
                      <span className="font-normal text-muted-foreground">
                        ({transaction.fuelUnit ?? "L"})
                      </span>
                    </span>
                    <Input
                      inputMode="decimal"
                      value={fuelQuantity}
                      onChange={(e) =>
                        setFuelQuantity(
                          e.target.value.replace(/[^\d.]/g, "").slice(0, 10),
                        )
                      }
                      className="mt-0.5 h-8 text-xs"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] font-medium">Odometer (km)</span>
                    <Input
                      inputMode="numeric"
                      value={fuelOdometer}
                      onChange={(e) =>
                        setFuelOdometer(
                          e.target.value.replace(/\D/g, "").slice(0, 8),
                        )
                      }
                      className="mt-0.5 h-8 text-xs"
                    />
                  </label>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Clearing either field re-saves it as empty; mileage on
                  the vehicle page recalculates automatically.
                </p>
              </div>
            )}
            <label className="block">
              <span className="text-xs font-medium">
                Tag to event / trip{" "}
                <span className="text-muted-foreground">(optional)</span>
              </span>
              <NativeSelect
                value={eventId}
                onChange={(v) => setEventId(v)}
                options={[
                  { value: "", label: "— none —" },
                  ...events.map((e) => {
                    const date = new Date(e.startedAt)
                      .toISOString()
                      .slice(0, 10);
                    return {
                      value: e.id,
                      label: `${e.name} · ${date} (${e.kind.toLowerCase()})`,
                    };
                  }),
                ]}
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
            <div className="rounded-md border bg-muted/30 p-3 space-y-2">
              <div className="text-xs font-medium">Receipts / supporting files</div>
              <AttachmentList
                ownerKind="TRANSACTION_RECEIPT"
                ownerId={transaction.id}
                emptyMessage="No receipts attached. Upload PDF or image (max 10 MB)."
                accept="image/*,application/pdf"
              />
            </div>
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
