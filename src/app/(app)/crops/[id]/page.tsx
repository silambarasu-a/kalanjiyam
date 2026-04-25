"use client";
import { toast } from "sonner";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR, { mutate as globalMutate } from "swr";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatINR, formatDate } from "@/lib/utils";

type CropDetail = { id: string; name: string };
type Batch = {
  id: string;
  name: string;
  status: "PLANNED" | "ACTIVE" | "HARVESTED" | "CLOSED";
  startDate: string | null;
  endDate: string | null;
  expectedCycleDays: number | null;
  notes: string | null;
  active: boolean;
  crop: { id: string; name: string };
  land: { id: string; name: string } | null;
};
type Land = { id: string; name: string };

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function CropDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const { data: cropsData } = useSWR<{ crops: (CropDetail & { description: string | null; category: string | null })[] }>(
    "/api/crops",
    fetcher
  );
  const { data: batchesData } = useSWR<{ batches: Batch[] }>(
    id ? `/api/crop-batches?cropId=${id}&active=false` : null,
    fetcher
  );
  const { data: landsData } = useSWR<{ lands: Land[] }>("/api/land", fetcher);
  const [editOpen, setEditOpen] = useState<Batch | "new" | null>(null);

  const crop = (cropsData?.crops ?? []).find((c) => c.id === id);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/crops" className="text-xs text-muted-foreground">
          ← Crops
        </Link>
        <div className="mt-1 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{crop?.name ?? "…"}</h1>
            {crop?.category && (
              <div className="text-xs uppercase tracking-widest text-muted-foreground">
                {crop.category}
              </div>
            )}
            {crop?.description && (
              <p className="mt-1 text-sm text-muted-foreground">{crop.description}</p>
            )}
          </div>
          <Button onClick={() => setEditOpen("new")} className="gap-2">
            <Plus className="h-4 w-4" /> New batch
          </Button>
        </div>
      </div>

      <div className="rounded-lg border bg-card divide-y">
        {(batchesData?.batches ?? []).map((b) => (
          <BatchRow
            key={b.id}
            batch={b}
            onEdit={() => setEditOpen(b)}
            onDelete={async () => {
              if (!confirm(`Delete batch "${b.name}"?`)) return;
              const res = await fetch(`/api/crop-batches/${b.id}`, { method: "DELETE" });
              if (!res.ok) {
                const body = await res.json();
                toast.error(body.error ?? "Failed");
              }
              globalMutate(`/api/crop-batches?cropId=${id}&active=false`);
            }}
          />
        ))}
        {(batchesData?.batches ?? []).length === 0 && (
          <div className="px-5 py-8 text-sm text-muted-foreground text-center">
            No batches yet. Add the first one to track P&amp;L per cycle.
          </div>
        )}
      </div>

      <BatchDialog
        cropId={id ?? ""}
        batch={editOpen === "new" ? null : (editOpen as Batch | null)}
        lands={landsData?.lands ?? []}
        open={editOpen !== null}
        onClose={() => setEditOpen(null)}
      />
    </div>
  );
}

function BatchRow({
  batch,
  onEdit,
  onDelete,
}: {
  batch: Batch;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { data } = useSWR<{ summary: { income: number; expense: number; net: number; transactions: number } }>(
    `/api/crop-batches/${batch.id}`,
    fetcher
  );

  return (
    <div className="px-5 py-3 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{batch.name}</span>
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
            {batch.status}
          </span>
        </div>
        <div className="text-xs text-muted-foreground">
          {batch.startDate ? `Started ${formatDate(batch.startDate)}` : "No start date"}
          {batch.expectedCycleDays ? ` · ~${batch.expectedCycleDays}d cycle` : ""}
          {batch.land ? ` · ${batch.land.name}` : ""}
          {data?.summary ? ` · ${data.summary.transactions} txns` : ""}
        </div>
      </div>
      {data?.summary && (
        <div className="text-right">
          <div className={`text-sm font-semibold ${data.summary.net >= 0 ? "text-emerald-700" : "text-red-700"}`}>
            {data.summary.net >= 0 ? "+" : "−"}
            {formatINR(Math.abs(data.summary.net))}
          </div>
          <div className="text-[10px] text-muted-foreground">
            +{formatINR(data.summary.income)} / −{formatINR(data.summary.expense)}
          </div>
        </div>
      )}
      <Button variant="ghost" size="icon" onClick={onEdit} aria-label="Edit">
        <Pencil className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon" onClick={onDelete} aria-label="Delete">
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </div>
  );
}

function BatchDialog({
  cropId,
  batch,
  lands,
  open,
  onClose,
}: {
  cropId: string;
  batch: Batch | null;
  lands: Land[];
  open: boolean;
  onClose: () => void;
}) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [name, setName] = useState("");
  const [status, setStatus] = useState<Batch["status"]>("ACTIVE");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState("");
  const [expectedCycleDays, setExpectedCycleDays] = useState("");
  const [landId, setLandId] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- reset form on open */
    setName(batch?.name ?? "");
    setStatus(batch?.status ?? "ACTIVE");
    setStartDate(batch?.startDate ? batch.startDate.slice(0, 10) : today);
    setEndDate(batch?.endDate ? batch.endDate.slice(0, 10) : "");
    setExpectedCycleDays(
      batch?.expectedCycleDays != null ? String(batch.expectedCycleDays) : ""
    );
    setLandId(batch?.land?.id ?? "");
    setNotes(batch?.notes ?? "");
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, batch, today]);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        name,
        status,
        startDate: startDate || null,
        endDate: endDate || null,
        expectedCycleDays: expectedCycleDays ? Number(expectedCycleDays) : null,
        landId: landId || null,
        notes: notes.trim() || undefined,
      };
      if (!batch) payload.cropId = cropId;
      const res = await fetch(batch ? `/api/crop-batches/${batch.id}` : "/api/crop-batches", {
        method: batch ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) setError(body.error ?? "Failed");
      else {
        globalMutate(`/api/crop-batches?cropId=${cropId}&active=false`);
        onClose();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{batch ? "Edit batch" : "New batch"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs font-medium">Name</span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              maxLength={80}
              placeholder="e.g. Coconut Mar-2026"
            />
          </label>
          <div>
            <span className="text-xs font-medium block mb-2">Status</span>
            <div className="flex flex-wrap gap-2">
              {(["PLANNED", "ACTIVE", "HARVESTED", "CLOSED"] as const).map((s) => (
                <Button
                  key={s}
                  type="button"
                  size="sm"
                  variant={status === s ? "default" : "outline"}
                  onClick={() => setStatus(s)}
                >
                  {s}
                </Button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium">Start date</span>
              <DateInput value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </label>
            <label className="block">
              <span className="text-xs font-medium">End date (optional)</span>
              <DateInput value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium">Expected cycle (days)</span>
            <Input
              type="number"
              min={1}
              value={expectedCycleDays}
              onChange={(e) => setExpectedCycleDays(e.target.value)}
              placeholder="e.g. 50 for coconut, 365 for mango"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium">Land / plot (optional)</span>
            <select
              className="w-full rounded border border-input bg-background px-2 py-2 text-sm mt-1"
              value={landId}
              onChange={(e) => setLandId(e.target.value)}
            >
              <option value="">— none —</option>
              {lands.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              Manage land plots from Settings (coming soon).
            </p>
          </label>
          <label className="block">
            <span className="text-xs font-medium">Notes</span>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={submitting || !name.trim()}>
            {batch ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
