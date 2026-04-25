"use client";
import { toast } from "sonner";

import { useEffect, useState } from "react";
import Link from "next/link";
import useSWR, { mutate as globalMutate } from "swr";
import { Plus, Pencil, Trash2, PawPrint } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Livestock = {
  id: string;
  name: string;
  species: string | null;
  description: string | null;
  active: boolean;
  activeBatchCount: number;
  totalCount: number;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function LivestockPage() {
  const { data, isLoading } = useSWR<{ livestock: Livestock[] }>("/api/livestock", fetcher);
  const [editOpen, setEditOpen] = useState<Livestock | "new" | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Livestock</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Animals you keep — goats, poultry, cattle, anything. Each kind has batches with live
            counts updated by birth, death, sale, and purchase events.
          </p>
        </div>
        <Button onClick={() => setEditOpen("new")} className="gap-2">
          <Plus className="h-4 w-4" /> New livestock
        </Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {(data?.livestock ?? []).map((l) => (
          <div key={l.id} className="rounded-lg border bg-card p-5 flex items-start gap-3">
            <PawPrint className="h-5 w-5 mt-0.5 text-primary shrink-0" />
            <Link href={`/livestock/${l.id}`} className="min-w-0 flex-1">
              <h3 className="font-semibold truncate">{l.name}</h3>
              <div className="mt-0.5 text-xs text-muted-foreground truncate">
                {l.species ? `${l.species} · ` : ""}
                {l.totalCount} head · {l.activeBatchCount} batch
                {l.activeBatchCount !== 1 ? "es" : ""}
              </div>
            </Link>
            <Button variant="ghost" size="icon" onClick={() => setEditOpen(l)} aria-label="Edit">
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={async () => {
                if (!confirm(`Delete ${l.name}?`)) return;
                const res = await fetch(`/api/livestock/${l.id}`, { method: "DELETE" });
                if (!res.ok) {
                  const body = await res.json();
                  toast.error(body.error ?? "Failed");
                }
                globalMutate("/api/livestock");
              }}
              aria-label="Delete"
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        ))}
        {(data?.livestock ?? []).length === 0 && !isLoading && (
          <div className="col-span-full rounded-lg border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
            No livestock yet. Add what you raise — sheep, goat, cow, poultry.
          </div>
        )}
      </div>

      <LivestockDialog
        livestock={editOpen === "new" ? null : (editOpen as Livestock | null)}
        open={editOpen !== null}
        onClose={() => setEditOpen(null)}
      />
    </div>
  );
}

function LivestockDialog({
  livestock,
  open,
  onClose,
}: {
  livestock: Livestock | null;
  open: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [species, setSpecies] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- reset on open */
    setName(livestock?.name ?? "");
    setSpecies(livestock?.species ?? "");
    setDescription(livestock?.description ?? "");
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, livestock]);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const payload = {
        name,
        species: species.trim() || undefined,
        description: description.trim() || undefined,
      };
      const res = await fetch(livestock ? `/api/livestock/${livestock.id}` : "/api/livestock", {
        method: livestock ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) setError(body.error ?? "Failed");
      else {
        globalMutate("/api/livestock");
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
          <DialogTitle>{livestock ? "Edit livestock" : "New livestock"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs font-medium">Name</span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              maxLength={80}
              placeholder="e.g. Goat, Country chicken"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium">Species (optional)</span>
            <Input
              value={species}
              onChange={(e) => setSpecies(e.target.value)}
              placeholder="e.g. caprine, bovine, poultry"
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
            {livestock ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
