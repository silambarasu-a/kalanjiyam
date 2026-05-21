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
import { DescriptionField } from "@/components/ui/description-field";
import { formatINR } from "@/lib/utils";

type EventType = "PURCHASE" | "BIRTH" | "DEATH" | "SALE";

/**
 * Edit a LivestockEvent row. Type + count + date + notes are mutable;
 * money fields (unitValue / weights) are locked when a Transaction is
 * already linked — same discipline as feed/milk/egg edits. Server
 * recomputes the head-count delta atomically.
 */
export function EditEventDialog({
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
    eventType: EventType;
    date: string;
    count: number;
    unitValue: number | null;
    avgWeightKg: number | null;
    totalWeightKg: number | null;
    transactionId?: string | null;
    notes: string | null;
  };
  onSaved: () => void;
}) {
  const [eventType, setEventType] = useState<EventType>(initial.eventType);
  const [date, setDate] = useState(initial.date.slice(0, 10));
  const [count, setCount] = useState(String(initial.count));
  const [notes, setNotes] = useState(initial.notes ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const moneyLocked =
    !!initial.transactionId &&
    (initial.eventType === "SALE" || initial.eventType === "PURCHASE");

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- reset on open */
    setEventType(initial.eventType);
    setDate(initial.date.slice(0, 10));
    setCount(String(initial.count));
    setNotes(initial.notes ?? "");
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, initial]);

  async function submit() {
    setError(null);
    if (!Number(count) || Number(count) <= 0)
      return setError("Count must be at least 1");
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/livestock-batches/${batchId}/events/${initial.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            eventType,
            date,
            count: Number(count),
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
          <DialogTitle>Edit event</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Type</Label>
            <div className="flex flex-wrap gap-1.5">
              {(["BIRTH", "DEATH", "SALE", "PURCHASE"] as const).map((e) => (
                <Button
                  key={e}
                  type="button"
                  size="sm"
                  variant={eventType === e ? "default" : "outline"}
                  onClick={() => setEventType(e)}
                >
                  {e}
                </Button>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground">
              Changing the type or count re-balances the head count
              automatically; the server refuses if the result would go
              below zero.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Count</Label>
              <Input
                inputMode="numeric"
                value={count}
                onChange={(e) =>
                  setCount(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Date</Label>
              <DateInput
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
          </div>

          {moneyLocked && (
            <div className="rounded-md border bg-muted/30 p-3 text-[11px]">
              <div className="flex items-center justify-between">
                <span className="font-medium">Linked transaction</span>
                <span className="tabular-nums">
                  {initial.unitValue != null
                    ? formatINR(initial.unitValue * initial.count)
                    : "—"}
                </span>
              </div>
              <p className="mt-1 text-muted-foreground">
                Per-unit value
                {initial.unitValue != null
                  ? ` ${formatINR(initial.unitValue)}`
                  : ""}
                {initial.avgWeightKg != null
                  ? ` · ${initial.avgWeightKg} kg/head`
                  : ""}
                . Locked here — delete + re-add to change pricing.
              </p>
            </div>
          )}

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
