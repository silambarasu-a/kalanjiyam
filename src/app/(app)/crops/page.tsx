"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import useSWR, { mutate as globalMutate } from "swr";
import { Plus, Pencil, Trash2, Sprout } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Crop = {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  active: boolean;
  activeBatchCount: number;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function CropsPage() {
  const { data, isLoading } = useSWR<{ crops: Crop[] }>("/api/crops", fetcher);
  const [editOpen, setEditOpen] = useState<Crop | "new" | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Crops</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your crop list. Each crop has its own batches with start dates, optional cycle length,
            and per-batch P&amp;L.
          </p>
        </div>
        <Button onClick={() => setEditOpen("new")} className="gap-2">
          <Plus className="h-4 w-4" /> New crop
        </Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {(data?.crops ?? []).map((c) => (
          <div key={c.id} className="rounded-lg border bg-card p-5 flex items-start gap-3">
            <Sprout className="h-5 w-5 mt-0.5 text-primary shrink-0" />
            <Link href={`/crops/${c.id}`} className="min-w-0 flex-1">
              <h3 className="font-semibold truncate">{c.name}</h3>
              <div className="mt-0.5 text-xs text-muted-foreground truncate">
                {c.category ? `${c.category} · ` : ""}
                {c.activeBatchCount} active batch{c.activeBatchCount !== 1 ? "es" : ""}
              </div>
              {c.description && (
                <div className="mt-1 text-xs text-muted-foreground truncate">{c.description}</div>
              )}
            </Link>
            <Button variant="ghost" size="icon" onClick={() => setEditOpen(c)} aria-label="Edit">
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={async () => {
                if (!confirm(`Delete ${c.name}?`)) return;
                const res = await fetch(`/api/crops/${c.id}`, { method: "DELETE" });
                if (!res.ok) {
                  const body = await res.json();
                  alert(body.error ?? "Failed");
                }
                globalMutate("/api/crops");
              }}
              aria-label="Delete"
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        ))}
        {(data?.crops ?? []).length === 0 && !isLoading && (
          <div className="col-span-full rounded-lg border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
            No crops yet. Add what you grow — coconut, mango, paddy, anything.
          </div>
        )}
      </div>

      <CropDialog
        crop={editOpen === "new" ? null : (editOpen as Crop | null)}
        open={editOpen !== null}
        onClose={() => setEditOpen(null)}
      />
    </div>
  );
}

function CropDialog({
  crop,
  open,
  onClose,
}: {
  crop: Crop | null;
  open: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- reset form on open */
    setName(crop?.name ?? "");
    setCategory(crop?.category ?? "");
    setDescription(crop?.description ?? "");
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, crop]);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const payload = {
        name,
        category: category.trim() || undefined,
        description: description.trim() || undefined,
      };
      const res = await fetch(crop ? `/api/crops/${crop.id}` : "/api/crops", {
        method: crop ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) setError(body.error ?? "Failed");
      else {
        globalMutate("/api/crops");
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
          <DialogTitle>{crop ? "Edit crop" : "New crop"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs font-medium">Name</span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              maxLength={80}
              placeholder="e.g. Coconut"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium">Category (optional)</span>
            <Input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g. Tree crop, Seasonal, Tuber"
              maxLength={40}
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium">Description (optional)</span>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={submitting || !name.trim()}>
            {crop ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
