"use client";

import { useState } from "react";
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
import { NativeSelect } from "@/components/ui/native-select";
import { DescriptionField } from "@/components/ui/description-field";

const CAUSE_OPTS = [
  { value: "UNKNOWN", label: "Unknown" },
  { value: "DISEASE", label: "Disease" },
  { value: "PREDATOR", label: "Predator" },
  { value: "INJURY", label: "Injury" },
  { value: "HEAT", label: "Heat stress" },
  { value: "COLD", label: "Cold stress" },
  { value: "STAMPEDE", label: "Stampede / crush" },
  { value: "OTHER", label: "Other" },
];

/**
 * Records (or edits) a mortality event. New entries auto-decrement the
 * batch's `currentCount`; edits adjust by the delta. The `culled`
 * checkbox separates farmer-initiated culls (sick / runt) from natural
 * deaths — contract integrators often pay for natural mortality but
 * never for culls.
 */
export function LogMortalityDialog({
  open,
  onOpenChange,
  batchId,
  animals,
  initial,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batchId: string;
  animals?: { id: string; tagNumber: string; name: string | null }[];
  initial?: {
    id: string;
    date: string;
    count: number;
    cause: string;
    culled: boolean;
    animalId: string | null;
    notes: string | null;
  };
  onSaved: () => void;
}) {
  const isEdit = !!initial;
  const [date, setDate] = useState(
    () => initial?.date.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
  );
  const [count, setCount] = useState(initial ? String(initial.count) : "1");
  const [cause, setCause] = useState(initial?.cause ?? "UNKNOWN");
  const [culled, setCulled] = useState(initial?.culled ?? false);
  const [animalId, setAnimalId] = useState(initial?.animalId ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPerAnimal = !!animalId;
  const effectiveCount = isPerAnimal ? 1 : Number(count);

  async function submit() {
    setError(null);
    if (!Number.isFinite(effectiveCount) || effectiveCount < 1) {
      return setError("Count must be at least 1");
    }
    setSubmitting(true);
    try {
      const url = isEdit
        ? `/api/livestock-batches/${batchId}/mortality/${initial!.id}`
        : `/api/livestock-batches/${batchId}/mortality`;
      const res = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          date,
          count: effectiveCount,
          cause,
          culled,
          animalId: animalId || null,
          notes: notes.trim() || undefined,
        }),
      });
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
          <DialogTitle>{isEdit ? "Edit mortality" : "Log mortality"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Date</Label>
              <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Cause</Label>
              <NativeSelect
                value={cause}
                onChange={setCause}
                options={CAUSE_OPTS}
              />
            </div>
          </div>

          {animals && animals.length > 0 && (
            <div className="space-y-1">
              <Label className="text-xs">
                Specific animal{" "}
                <span className="font-normal text-muted-foreground">
                  (optional · auto-deactivates the animal)
                </span>
              </Label>
              <NativeSelect
                value={animalId}
                onChange={setAnimalId}
                placeholder="— bulk mortality —"
                options={[
                  { value: "", label: "— bulk mortality —" },
                  ...animals
                    .filter(() => true)
                    .map((a) => ({
                      value: a.id,
                      label: a.name
                        ? `#${a.tagNumber} · ${a.name}`
                        : `#${a.tagNumber}`,
                    })),
                ]}
                searchable
              />
            </div>
          )}

          {!isPerAnimal && (
            <div className="space-y-1">
              <Label className="text-xs">Count</Label>
              <Input
                inputMode="numeric"
                value={count}
                onChange={(e) =>
                  setCount(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                placeholder="1"
              />
            </div>
          )}

          <label className="flex items-center gap-2 rounded-md border bg-muted/30 p-2.5 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={culled}
              onChange={(e) => setCulled(e.target.checked)}
              className="h-3.5 w-3.5 accent-primary"
            />
            <span>
              <span className="font-medium">Cull</span>
              <span className="text-muted-foreground">
                {" "}
                — farmer-initiated (sick / runt). Tracked separately so
                contract payout calculators can exclude these from
                eligible mortality.
              </span>
            </span>
          </label>

          <DescriptionField
            label="Notes"
            value={notes}
            onChange={setNotes}
            placeholder="Symptoms, vet diagnosis, time of day…"
            maxLength={500}
            rows={2}
          />

          {error && (
            <p className="text-xs text-destructive">{error}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={submitting}
            variant={isEdit ? "default" : "destructive"}
          >
            {submitting ? "Saving…" : isEdit ? "Save" : "Log mortality"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
