"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { AmountInput } from "@/components/ui/amount-input";
import { mutateBalances } from "@/lib/mutate-balances";
import { formatINR } from "@/lib/utils";

type Worker = {
  id: string;
  name: string;
  dailyRate: number | null;
};

type CropBatch = {
  id: string;
  name: string;
  status: string;
  crop: { id: string; name: string };
};

type LivestockBatch = {
  id: string;
  name: string;
  currentCount: number;
  livestock: { id: string; name: string };
};

type Entry = {
  rate: string;
  totalAmount: string;
  edited: boolean;
  selected: boolean;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function MarkAttendanceModal({
  open,
  onOpenChange,
  workers,
  onSaved,
  preselectedIds,
  focused = false,
  initialDate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  workers: Worker[];
  onSaved?: () => void;
  preselectedIds?: string[];
  // When focused, the modal targets a single worker (shown highlighted, no
  // checkbox/bulk controls). Used from the worker detail page.
  focused?: boolean;
  initialDate?: string;
}) {
  const today = todayIso();

  const { data: cropBatchesData } = useSWR<{ batches: CropBatch[] }>(
    open ? "/api/crop-batches?active=true" : null,
    fetcher
  );
  const { data: livestockBatchesData } = useSWR<{ batches: LivestockBatch[] }>(
    open ? "/api/livestock-batches?active=true" : null,
    fetcher
  );
  const cropBatches = cropBatchesData?.batches ?? [];
  const livestockBatches = livestockBatchesData?.batches ?? [];

  const [dates, setDates] = useState<string[]>([today]);
  // "" | "crop:<id>" | "livestock:<id>" — same shape as transaction dialog
  const [tagSource, setTagSource] = useState("");
  const [notes, setNotes] = useState("");
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [saving, setSaving] = useState(false);

  const focusedWorkerId = focused ? preselectedIds?.[0] : undefined;
  const focusedWorker = useMemo(
    () => workers.find((w) => w.id === focusedWorkerId) ?? null,
    [workers, focusedWorkerId]
  );

  // Reset on open. Preselects whichever workers were passed in.
  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- one-shot reset on open */
    setDates([initialDate ?? today]);
    const preset = new Set(preselectedIds ?? []);
    const init: Record<string, Entry> = {};
    workers.forEach((w) => {
      const sel = focused ? w.id === focusedWorkerId : preset.has(w.id);
      const rate = String(w.dailyRate ?? 0);
      init[w.id] = { rate, totalAmount: rate, edited: false, selected: sel };
    });
    setEntries(init);
    setTagSource("");
    setNotes("");
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional one-shot
  }, [open]);

  const dateCount = dates.length;

  // When the date count changes, re-sync each row's totalAmount = rate × dateCount,
  // unless the user manually edited that row.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- syncing derived totals across selected rows */
    setEntries((prev) => {
      let changed = false;
      const next = { ...prev };
      Object.entries(prev).forEach(([id, e]) => {
        if (!e.edited) {
          const computed = String((parseFloat(e.rate) || 0) * dateCount);
          if (computed !== e.totalAmount) {
            next[id] = { ...e, totalAmount: computed };
            changed = true;
          }
        }
      });
      return changed ? next : prev;
    });
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [dateCount]);

  function addDate() {
    // New row defaults to the day before the earliest already-picked date —
    // reflects the common "I forgot to log yesterday" workflow.
    const sorted = [...dates].sort();
    const earliest = sorted[0] ?? today;
    const d = new Date(earliest + "T00:00:00");
    d.setDate(d.getDate() - 1);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (!dates.includes(iso)) setDates((p) => [...p, iso].sort());
  }

  function removeDate(iso: string) {
    if (dates.length <= 1) return;
    setDates((p) => p.filter((d) => d !== iso));
  }

  function updateDate(oldIso: string, newIso: string) {
    if (!newIso || newIso > today) return;
    setDates((prev) => {
      if (prev.includes(newIso)) return prev;
      return prev.map((d) => (d === oldIso ? newIso : d)).sort();
    });
  }

  const filtered = useMemo(
    () => (focused && focusedWorker ? [focusedWorker] : workers),
    [workers, focused, focusedWorker]
  );

  const selectedCount = Object.values(entries).filter((e) => e.selected).length;
  const accrued = useMemo(
    () =>
      Object.values(entries).reduce(
        (s, e) => s + (e.selected ? parseFloat(e.totalAmount) || 0 : 0),
        0
      ),
    [entries]
  );
  const hasZeroAmount = useMemo(
    () =>
      Object.values(entries).some(
        (e) => e.selected && (parseFloat(e.totalAmount) || 0) === 0
      ),
    [entries]
  );

  function toggle(id: string) {
    setEntries((p) => ({ ...p, [id]: { ...p[id], selected: !p[id].selected } }));
  }
  function markAllPresent() {
    setEntries((p) => {
      const n = { ...p };
      filtered.forEach((w) => {
        n[w.id] = { ...n[w.id], selected: true };
      });
      return n;
    });
  }
  function clearAll() {
    setEntries((p) => {
      const n = { ...p };
      Object.keys(n).forEach((id) => {
        n[id] = { ...n[id], selected: false };
      });
      return n;
    });
  }
  function updateTotal(id: string, v: string) {
    setEntries((p) => ({ ...p, [id]: { ...p[id], totalAmount: v, edited: true } }));
  }

  async function handleSave() {
    const selEntries = Object.entries(entries)
      .filter(([, e]) => e.selected)
      .map(([workerId, e]) => {
        const total = parseFloat(e.totalAmount) || 0;
        const perDay = dateCount > 0 ? total / dateCount : 0;
        return {
          workerId,
          dailyRateOverride: total > 0 ? perDay : null,
          present: total > 0,
        };
      });

    if (selEntries.length === 0) {
      toast.error("Select at least one worker");
      return;
    }
    if (hasZeroAmount && !notes.trim()) {
      toast.error("Notes are required when marking leave (₹0)");
      return;
    }

    const cropBatchId = tagSource.startsWith("crop:") ? tagSource.slice(5) : null;
    const livestockBatchId = tagSource.startsWith("livestock:")
      ? tagSource.slice(10)
      : null;

    setSaving(true);
    let failed = 0;
    for (const date of dates) {
      const res = await fetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          cropBatchId,
          livestockBatchId,
          notes: notes.trim() || undefined,
          entries: selEntries,
        }),
      });
      if (!res.ok) failed++;
    }
    setSaving(false);
    if (failed === 0) {
      toast.success(
        `Attendance saved — ${selEntries.length} worker(s) × ${dates.length} date(s)`
      );
      globalMutate((k) => typeof k === "string" && k.startsWith("/api/workers"));
      globalMutate((k) => typeof k === "string" && k.startsWith("/api/attendance"));
      await mutateBalances();
      onSaved?.();
      onOpenChange(false);
    } else {
      toast.error(`${failed} date(s) failed to save`);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(42rem,calc(100%-2rem))]">
        <DialogHeader>
          <DialogTitle>
            {focused && focusedWorker
              ? `Mark attendance — ${focusedWorker.name}`
              : "Mark attendance"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <span className="text-xs font-medium">Dates</span>
            <div className="space-y-2">
              {dates.map((date) => (
                <div key={date} className="flex items-center gap-2">
                  <DateInput
                    value={date}
                    max={today}
                    onChange={(e) => updateDate(date, e.target.value)}
                  />
                  {dates.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeDate(date)}
                      className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                      aria-label="Remove date"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={addDate}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
              >
                <Plus className="h-4 w-4" />
                Add another date
              </button>
            </div>
          </div>

          {(cropBatches.length > 0 || livestockBatches.length > 0) && (
            <label className="block">
              <span className="text-xs font-medium">Tag to batch (optional)</span>
              <select
                className="w-full rounded border border-input bg-background px-2 py-2 text-sm mt-1"
                value={tagSource}
                onChange={(e) => setTagSource(e.target.value)}
              >
                <option value="">— none —</option>
                {cropBatches.length > 0 && (
                  <optgroup label="Crops">
                    {cropBatches.map((b) => (
                      <option key={b.id} value={`crop:${b.id}`}>
                        {b.crop.name} · {b.name} ({b.status})
                      </option>
                    ))}
                  </optgroup>
                )}
                {livestockBatches.length > 0 && (
                  <optgroup label="Livestock">
                    {livestockBatches.map((b) => (
                      <option key={b.id} value={`livestock:${b.id}`}>
                        {b.livestock.name} · {b.name} ({b.currentCount} head)
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
          )}

          {!focused && (
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">
                Workers ({selectedCount} selected)
              </span>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={markAllPresent}>
                  Mark all present
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={clearAll}>
                  Clear
                </Button>
              </div>
            </div>
          )}

          <div className="border rounded-md divide-y max-h-64 overflow-y-auto">
            <div className="grid grid-cols-[1fr_auto] gap-2 px-3 py-2 bg-muted/50 text-[11px] font-medium text-muted-foreground sticky top-0">
              <span>Worker</span>
              <span className="w-28 text-right">Wages ₹</span>
            </div>
            {filtered.length === 0 && (
              <p className="p-4 text-sm text-muted-foreground text-center">No workers</p>
            )}
            {filtered.map((w) => {
              const e = entries[w.id];
              if (!e) return null;
              const isFoc = focused && w.id === focusedWorkerId;
              const perDay =
                dateCount > 0
                  ? Math.round((parseFloat(e.totalAmount) || 0) / dateCount)
                  : parseFloat(e.rate) || 0;
              const isLeave = e.selected && (parseFloat(e.totalAmount) || 0) === 0;
              return (
                <div
                  key={w.id}
                  className={`flex items-center gap-3 px-3 py-2.5 ${
                    isFoc
                      ? "bg-accent/60 border-l-4 border-primary"
                      : "hover:bg-muted/40"
                  }`}
                >
                  {!focused && (
                    <input
                      type="checkbox"
                      checked={e.selected}
                      onChange={() => toggle(w.id)}
                      className="h-4 w-4 accent-primary"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{w.name}</p>
                    {(focused || e.selected) && (
                      <p className="text-xs text-muted-foreground">
                        {isLeave ? (
                          <span className="text-amber-600 font-medium">Leave</span>
                        ) : (
                          <>
                            {dateCount} day{dateCount !== 1 ? "s" : ""} · ₹{perDay}/day
                          </>
                        )}
                      </p>
                    )}
                  </div>
                  <div className="w-28">
                    <AmountInput
                      value={e.totalAmount}
                      onChange={(v) => updateTotal(w.id, v)}
                      placeholder="0"
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between rounded-md border bg-muted/30 px-4 py-3 text-sm">
            <span className="text-muted-foreground">
              {selectedCount === 0
                ? "Select workers to mark attendance"
                : `${selectedCount} worker(s) × ${dateCount} date(s)`}
            </span>
            <span className="font-semibold">Accrued {formatINR(accrued)}</span>
          </div>

          <label className="block">
            <span className="text-xs font-medium">
              Notes {hasZeroAmount ? <span className="text-destructive">*</span> : "(optional)"}
            </span>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Shared note — applied to every marked row"
              maxLength={500}
            />
          </label>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || (!focused && selectedCount === 0)}
          >
            {saving
              ? "Saving…"
              : `Save${dateCount > 1 ? ` (${dateCount} dates)` : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
