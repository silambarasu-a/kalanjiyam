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

const SEX_OPTS = [
  { value: "UNKNOWN", label: "Unknown" },
  { value: "FEMALE", label: "Female" },
  { value: "MALE", label: "Male" },
];

type AnimalDraft = {
  id?: string;
  tagNumber: string;
  name: string;
  sex: string;
  dob: string;
  breed: string;
  color: string;
  notes: string;
};

const EMPTY: AnimalDraft = {
  tagNumber: "",
  name: "",
  sex: "UNKNOWN",
  dob: "",
  breed: "",
  color: "",
  notes: "",
};

/**
 * Add or edit a single animal under a batch. Used by per-animal flows
 * (dairy cows, named goats, etc.) — bulk poultry batches usually skip
 * this entirely and operate at batch granularity.
 */
export function AnimalFormDialog({
  open,
  onOpenChange,
  batchId,
  initial,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batchId: string;
  initial?: Partial<AnimalDraft> & { id?: string };
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<AnimalDraft>({
    ...EMPTY,
    ...initial,
    sex: initial?.sex ?? "UNKNOWN",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = !!initial?.id;

  async function submit() {
    setError(null);
    if (!draft.tagNumber.trim())
      return setError("Tag number is required");
    setSubmitting(true);
    try {
      const url = isEdit
        ? `/api/livestock-batches/${batchId}/animals/${initial?.id}`
        : `/api/livestock-batches/${batchId}/animals`;
      const res = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tagNumber: draft.tagNumber.trim(),
          name: draft.name.trim() || null,
          sex: draft.sex,
          dob: draft.dob || null,
          breed: draft.breed.trim() || null,
          color: draft.color.trim() || null,
          notes: draft.notes.trim() || null,
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

  function set<K extends keyof AnimalDraft>(k: K, v: AnimalDraft[K]) {
    setDraft((d) => ({ ...d, [k]: v }));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit animal" : "Add animal"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Tag number</Label>
              <Input
                value={draft.tagNumber}
                onChange={(e) => set("tagNumber", e.target.value)}
                placeholder="EAR-001"
                maxLength={40}
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Name (optional)</Label>
              <Input
                value={draft.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="Lakshmi"
                maxLength={80}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Sex</Label>
              <NativeSelect
                value={draft.sex}
                onChange={(v) => set("sex", v)}
                options={SEX_OPTS}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Date of birth</Label>
              <DateInput
                value={draft.dob}
                onChange={(e) => set("dob", e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Breed</Label>
              <Input
                value={draft.breed}
                onChange={(e) => set("breed", e.target.value)}
                placeholder="Jersey, Boer…"
                maxLength={60}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Color / markings</Label>
              <Input
                value={draft.color}
                onChange={(e) => set("color", e.target.value)}
                placeholder="Black, white spot…"
                maxLength={40}
              />
            </div>
          </div>

          <DescriptionField
            label="Notes"
            value={draft.notes}
            onChange={(v) => set("notes", v)}
            placeholder="Lineage, temperament, anything worth remembering…"
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
            {submitting ? "Saving…" : isEdit ? "Save" : "Add animal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
