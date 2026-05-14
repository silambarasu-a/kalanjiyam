"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { mutate as globalMutate } from "swr";
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

export type EventDraft = {
  id?: string;
  name: string;
  kind: "TRIP" | "FUNCTION" | "FESTIVAL" | "PROJECT" | "MEDICAL" | "OTHER";
  startedAt: string;
  endedAt: string | null;
  notes: string | null;
  budget: number | null;
};

const KIND_OPTIONS: { value: EventDraft["kind"]; label: string }[] = [
  { value: "TRIP", label: "Trip" },
  { value: "FUNCTION", label: "Function (wedding / birthday / anniversary)" },
  { value: "FESTIVAL", label: "Festival" },
  { value: "PROJECT", label: "Project (renovation / setup)" },
  { value: "MEDICAL", label: "Medical episode" },
  { value: "OTHER", label: "Other" },
];

export function EventDialog({
  open,
  onClose,
  event,
}: {
  open: boolean;
  onClose: () => void;
  /** When set, dialog opens in edit mode and PATCHes on save. */
  event?: EventDraft | null;
}) {
  const editing = !!event?.id;
  const [name, setName] = useState("");
  const [kind, setKind] = useState<EventDraft["kind"]>("TRIP");
  const [startedAt, setStartedAt] = useState("");
  const [endedAt, setEndedAt] = useState("");
  const [budget, setBudget] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- prefill on dialog open */
    setName(event?.name ?? "");
    setKind(event?.kind ?? "TRIP");
    setStartedAt(
      event?.startedAt
        ? event.startedAt.slice(0, 10)
        : new Date().toISOString().slice(0, 10),
    );
    setEndedAt(event?.endedAt ? event.endedAt.slice(0, 10) : "");
    setBudget(event?.budget != null ? String(event.budget) : "");
    setNotes(event?.notes ?? "");
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, event]);

  async function submit() {
    setError(null);
    if (!name.trim()) {
      setError("Pick a name for this event");
      return;
    }
    if (!startedAt) {
      setError("Start date is required");
      return;
    }
    if (endedAt && new Date(endedAt) < new Date(startedAt)) {
      setError("End date can't be before start date");
      return;
    }
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        kind,
        startedAt,
        endedAt: endedAt || null,
        notes: notes.trim() || null,
        budget: budget ? Number(budget) : null,
      };
      const url = editing ? `/api/events/${event!.id}` : "/api/events";
      const res = await fetch(url, {
        method: editing ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Failed to save");
        return;
      }
      toast.success(editing ? "Event updated" : "Event created");
      globalMutate((k) => typeof k === "string" && k.startsWith("/api/events"));
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit event" : "New event"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs font-medium">Name</span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              maxLength={120}
              placeholder="e.g. Tirupati trip, Vidya's wedding"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium">Kind</span>
            <NativeSelect
              value={kind}
              onChange={(v) => setKind(v as EventDraft["kind"])}
              options={KIND_OPTIONS}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium">Starts</span>
              <DateInput
                value={startedAt}
                onChange={(e) => setStartedAt(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium">
                Ends <span className="font-normal text-muted-foreground">(optional)</span>
              </span>
              <DateInput
                value={endedAt}
                onChange={(e) => setEndedAt(e.target.value)}
              />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium">
              Budget <span className="font-normal text-muted-foreground">(optional)</span>
            </span>
            <AmountInput value={budget} onChange={setBudget} placeholder="0" />
            <span className="mt-1 block text-[10px] text-muted-foreground">
              When set, the event card shows a progress bar and warns when spend
              approaches the cap.
            </span>
          </label>
          <label className="block">
            <span className="text-xs font-medium">Notes</span>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={500}
            />
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting || !name.trim()}>
            {submitting ? "Saving…" : editing ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
