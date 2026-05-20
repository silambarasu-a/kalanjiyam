"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DateInput } from "@/components/ui/date-input";
import { AmountInput } from "@/components/ui/amount-input";
import { DescriptionField } from "@/components/ui/description-field";

/**
 * Edit a FeedLog row. Amount is locked (mirrored on the linked
 * EXPENSE Transaction). Quantity / unit / date / notes can change;
 * date edits sync the linked Transaction's date server-side.
 */
export function EditFeedDialog({
  open,
  onOpenChange,
  batchId,
  initial,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batchId: string;
  initial: {
    id: string;
    date: string;
    amount: number;
    quantity: number | null;
    unit: string | null;
    notes: string | null;
  };
  onSaved: () => void;
}) {
  const [date, setDate] = useState(initial.date.slice(0, 10));
  const [quantity, setQuantity] = useState(
    initial.quantity != null ? String(initial.quantity) : "",
  );
  const [unit, setUnit] = useState(initial.unit ?? "");
  const [notes, setNotes] = useState(initial.notes ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- reset on open */
    setDate(initial.date.slice(0, 10));
    setQuantity(initial.quantity != null ? String(initial.quantity) : "");
    setUnit(initial.unit ?? "");
    setNotes(initial.notes ?? "");
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, initial]);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/livestock-batches/${batchId}/feed/${initial.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            date,
            quantity: quantity ? Number(quantity) : null,
            unit: unit.trim() || null,
            notes: notes.trim() || null,
          }),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Failed to save");
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
          <DialogTitle>Edit feed log</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Date</Label>
            <DateInput
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
            <span className="font-medium">Cost</span>{" "}
            <span className="tabular-nums">
              ₹{initial.amount.toLocaleString("en-IN")}
            </span>
            <span className="ml-2 text-[10px] text-muted-foreground">
              locked — delete + re-add to change
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Quantity</Label>
              <AmountInput value={quantity} onChange={setQuantity} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Unit</Label>
              <Input
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="kg, bag…"
                maxLength={20}
              />
            </div>
          </div>
          <DescriptionField
            label="Notes"
            value={notes}
            onChange={setNotes}
            placeholder="Optional"
            maxLength={500}
            rows={2}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
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
