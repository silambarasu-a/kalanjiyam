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

/**
 * Edit a VaccinationLog row. Doesn't expose `cost` — re-pricing means
 * delete + recreate so the linked Transaction stays honest. Changing
 * `nextDueDate` re-syncs the reminder row (server-side).
 */
export function EditVaccinationDialog({
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
    vaccine: string;
    date: string;
    nextDueDate: string | null;
    notes: string | null;
  };
  onSaved: () => void;
}) {
  const [vaccine, setVaccine] = useState(initial.vaccine);
  const [date, setDate] = useState(initial.date.slice(0, 10));
  const [nextDueDate, setNextDueDate] = useState(
    initial.nextDueDate?.slice(0, 10) ?? "",
  );
  const [notes, setNotes] = useState(initial.notes ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- reset on open */
    setVaccine(initial.vaccine);
    setDate(initial.date.slice(0, 10));
    setNextDueDate(initial.nextDueDate?.slice(0, 10) ?? "");
    setNotes(initial.notes ?? "");
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, initial]);

  async function submit() {
    setError(null);
    if (!vaccine.trim()) return setError("Vaccine name is required");
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/livestock-batches/${batchId}/vaccination/${initial.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            vaccine: vaccine.trim(),
            date,
            nextDueDate: nextDueDate || null,
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
          <DialogTitle>Edit vaccination</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Vaccine</Label>
            <Input
              value={vaccine}
              onChange={(e) => setVaccine(e.target.value)}
              maxLength={80}
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Date</Label>
              <DateInput
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Next due</Label>
              <DateInput
                value={nextDueDate}
                onChange={(e) => setNextDueDate(e.target.value)}
              />
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Changing the next-due date re-syncs the reminder row used by
            the notifications cron. Cost is locked — delete + re-add to
            change it.
          </p>
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
