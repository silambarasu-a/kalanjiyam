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

const PHASE_OPTS = [
  { value: "ARRIVAL", label: "Arrival" },
  { value: "INTERIM", label: "Interim" },
  { value: "WEEKLY", label: "Weekly" },
  { value: "EXIT", label: "Exit / sale" },
] as const;

/**
 * Logs (or edits) a weighing event against a batch. Average weight is
 * derived server-side from totalKg / sampleSize, so the form only asks
 * for the raw values (matches how farmers actually record it). Pass
 * `initial` to switch into edit mode — the dialog PATCHes instead of
 * POSTs and the title flips to "Edit weighing".
 */
export function LogWeighingDialog({
  open,
  onOpenChange,
  batchId,
  defaultPhase = "INTERIM",
  animals,
  initial,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batchId: string;
  defaultPhase?: "ARRIVAL" | "INTERIM" | "WEEKLY" | "EXIT";
  animals?: { id: string; tagNumber: string; name: string | null }[];
  initial?: {
    id: string;
    date: string;
    phase: "ARRIVAL" | "INTERIM" | "WEEKLY" | "EXIT";
    sampleSize: number;
    totalKg: number;
    animalId: string | null;
    notes: string | null;
  };
  onSaved: () => void;
}) {
  const isEdit = !!initial;
  const [date, setDate] = useState(
    () => initial?.date.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
  );
  const [phase, setPhase] = useState<string>(initial?.phase ?? defaultPhase);
  const [sampleSize, setSampleSize] = useState(
    initial ? String(initial.sampleSize) : "10",
  );
  const [totalKg, setTotalKg] = useState(
    initial ? String(initial.totalKg) : "",
  );
  const [animalId, setAnimalId] = useState(initial?.animalId ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    const sample = Number(sampleSize);
    const total = Number(totalKg);
    if (!Number.isFinite(sample) || sample <= 0)
      return setError("Sample size must be at least 1");
    if (!Number.isFinite(total) || total <= 0)
      return setError("Total weight must be positive");
    setSubmitting(true);
    try {
      const url = isEdit
        ? `/api/livestock-batches/${batchId}/weighings/${initial!.id}`
        : `/api/livestock-batches/${batchId}/weighings`;
      const res = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          phase,
          date,
          sampleSize: sample,
          totalKg: total,
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

  const avg =
    Number(totalKg) > 0 && Number(sampleSize) > 0
      ? (Number(totalKg) / Number(sampleSize)).toFixed(3)
      : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit weighing" : "Log weighing"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Date</Label>
              <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Phase</Label>
              <NativeSelect
                value={phase}
                onChange={setPhase}
                options={PHASE_OPTS.map((o) => ({
                  value: o.value,
                  label: o.label,
                }))}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Sample size (birds)</Label>
              <Input
                inputMode="numeric"
                value={sampleSize}
                onChange={(e) =>
                  setSampleSize(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                placeholder="10"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Total weight (kg)</Label>
              <Input
                inputMode="decimal"
                value={totalKg}
                onChange={(e) =>
                  setTotalKg(e.target.value.replace(/[^\d.]/g, "").slice(0, 10))
                }
                placeholder="22.5"
                autoFocus
              />
            </div>
          </div>
          {avg && (
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
              <span className="font-medium">Avg per bird:</span>{" "}
              <span className="tabular-nums">{avg} kg</span>
            </div>
          )}
          {animals && animals.length > 0 && (
            <div className="space-y-1">
              <Label className="text-xs">
                Specific animal{" "}
                <span className="font-normal text-muted-foreground">
                  (optional · for per-animal weighings)
                </span>
              </Label>
              <NativeSelect
                value={animalId}
                onChange={setAnimalId}
                placeholder="— bulk weighing —"
                options={[
                  { value: "", label: "— bulk weighing —" },
                  ...animals.map((a) => ({
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
          <DescriptionField
            label="Notes"
            value={notes}
            onChange={setNotes}
            placeholder="Optional context (sampling method, weather…)"
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
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "Saving…" : isEdit ? "Save" : "Log weighing"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
