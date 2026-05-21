"use client";
import { toast } from "sonner";

import { useEffect, useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import {
  ArrowRight,
  Gauge,
  MapPin,
  PawPrint,
  Pencil,
  Plus,
  Trash2,
  Upload,
  Wallet,
} from "lucide-react";
import { FarmSubNav } from "@/components/layout/farm-sub-nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DescriptionField } from "@/components/ui/description-field";
import { Skeleton } from "@/components/ui/skeleton";
import { fetcher } from "@/lib/swr-fetcher";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BulkImportDialog } from "@/components/livestock/bulk-import-dialog";
import { NavigatingCard } from "@/components/ui/navigating-card";

type Livestock = {
  id: string;
  name: string;
  species: string | null;
  description: string | null;
  active: boolean;
  activeBatchCount: number;
  totalCount: number;
};

type ContractRow = {
  id: string;
  integratorName: string;
  contractRef: string | null;
  batchCount: number;
};

type ShedRow = {
  landId: string | null;
  landName: string;
  area: number | null;
  areaUnit: string | null;
  batches: {
    id: string;
    name: string;
    livestockName: string;
    productionType: string;
    head: number;
    mortalityPct: number;
    fcr: number | null;
    daysInCycle: number;
  }[];
  totalHead: number;
  avgMortalityPct: number;
  densityPerUnit: number | null;
};

export default function LivestockPage() {
  const { data, isLoading } = useSWR<{ livestock: Livestock[] }>(
    "/api/livestock",
    fetcher,
  );
  const { data: contractsRes } = useSWR<{ contracts: ContractRow[] }>(
    "/api/livestock-contracts",
    fetcher,
  );
  const { data: shedsRes } = useSWR<{ sheds: ShedRow[] }>(
    "/api/reports/livestock-by-shed",
    fetcher,
  );
  const [editOpen, setEditOpen] = useState<Livestock | "new" | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const items = data?.livestock ?? [];
  const totalHead = items.reduce((s, l) => s + l.totalCount, 0);
  const totalBatches = items.reduce((s, l) => s + l.activeBatchCount, 0);
  const contracts = contractsRes?.contracts ?? [];
  const sheds = shedsRes?.sheds ?? [];
  const linkedSheds = sheds.filter((s) => s.landId != null);

  return (
    <div className="space-y-6">
      <FarmSubNav />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Livestock</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Animals you raise — broilers, country chicken, dairy, goats, sheep,
            anything. Each kind hosts batches with head counts, feed logs,
            mortality, and (where it applies) FCR + contract payout estimates.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setImportOpen(true)}
            className="gap-2"
          >
            <Upload className="h-4 w-4" /> Bulk import
          </Button>
          <Button onClick={() => setEditOpen("new")} className="gap-2">
            <Plus className="h-4 w-4" /> New livestock
          </Button>
        </div>
      </div>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Kinds tracked" value={`${items.length}`} />
        <KpiCard label="Active batches" value={`${totalBatches}`} />
        <KpiCard label="Total head" value={`${totalHead}`} />
        <KpiCard
          label="Contracts"
          value={`${contracts.length}`}
          hint={
            contracts.length > 0
              ? `${contracts.filter((c) => c.batchCount > 0).length} in use`
              : "Suguna / Sakthi / Venky's, etc."
          }
        />
      </section>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card p-10 text-center">
          <PawPrint className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">No livestock yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Add what you raise — broiler, country chicken, dairy cow, goat,
            sheep — and you&rsquo;ll be able to create batches under it.
          </p>
          <Button
            onClick={() => setEditOpen("new")}
            className="mt-4 gap-2"
          >
            <Plus className="h-4 w-4" /> New livestock
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {items.map((l) => (
            <LivestockCard
              key={l.id}
              livestock={l}
              onEdit={() => setEditOpen(l)}
              onDelete={async () => {
                if (!confirm(`Delete ${l.name}?`)) return;
                const res = await fetch(`/api/livestock/${l.id}`, {
                  method: "DELETE",
                });
                if (!res.ok) {
                  const body = await res.json().catch(() => ({}));
                  toast.error(body.error ?? "Failed");
                  return;
                }
                toast.success("Deleted");
                globalMutate("/api/livestock");
              }}
            />
          ))}
        </div>
      )}

      {linkedSheds.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold inline-flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" /> By shed
            </h2>
            <span className="text-[10px] text-muted-foreground">
              {linkedSheds.length} shed{linkedSheds.length === 1 ? "" : "s"} in use
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {linkedSheds.map((s) => (
              <div
                key={s.landId}
                className="rounded-xl border bg-card p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">
                      {s.landName}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {s.area != null && s.areaUnit
                        ? `${s.area} ${s.areaUnit}`
                        : "Area not set"}
                      {s.batches.length > 0 &&
                        ` · ${s.batches.length} batch${s.batches.length === 1 ? "" : "es"}`}
                    </div>
                  </div>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] tabular-nums">
                    {s.totalHead} head
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-[10px]">
                  <div className="rounded-md border bg-muted/30 px-2 py-1">
                    <div className="text-muted-foreground">Mortality</div>
                    <div
                      className={`tabular-nums font-medium ${s.avgMortalityPct > 5 ? "text-destructive" : ""}`}
                    >
                      {s.avgMortalityPct.toFixed(1)}%
                    </div>
                  </div>
                  <div className="rounded-md border bg-muted/30 px-2 py-1">
                    <div className="text-muted-foreground inline-flex items-center gap-1">
                      <Gauge className="h-2.5 w-2.5" /> Density
                    </div>
                    <div className="tabular-nums font-medium">
                      {s.densityPerUnit != null
                        ? `${s.densityPerUnit}/${s.areaUnit ?? "unit"}`
                        : "—"}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {contracts.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">Contracts</h2>
            <span className="text-[10px] text-muted-foreground">
              Integrator relationships — link from each broiler-contract batch
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {contracts.map((c) => (
              <NavigatingCard
                key={c.id}
                href={`/livestock-contracts/${c.id}`}
                ariaLabel={`Open ${c.integratorName} contract`}
                className="rounded-xl border bg-card p-3 hover:shadow-sm hover:border-primary/30"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">
                      {c.integratorName}
                    </div>
                    {c.contractRef && (
                      <div className="text-[10px] text-muted-foreground">
                        {c.contractRef}
                      </div>
                    )}
                  </div>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] tabular-nums">
                    {c.batchCount} batch{c.batchCount === 1 ? "" : "es"}
                  </span>
                </div>
              </NavigatingCard>
            ))}
          </div>
        </section>
      )}

      <LivestockDialog
        livestock={editOpen === "new" ? null : (editOpen as Livestock | null)}
        open={editOpen !== null}
        onClose={() => setEditOpen(null)}
      />
      <BulkImportDialog
        key={`bulk-${importOpen}`}
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={() => {
          globalMutate("/api/livestock");
          globalMutate("/api/reports/livestock-by-shed");
          globalMutate("/api/reports/livestock-overview");
        }}
      />
    </div>
  );
}

function LivestockCard({
  livestock,
  onEdit,
  onDelete,
}: {
  livestock: Livestock;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const stop = (handler: () => void) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    handler();
  };
  return (
    <NavigatingCard
      href={`/livestock/${livestock.id}`}
      ariaLabel={`Open ${livestock.name}`}
      className="rounded-xl border bg-card p-4 hover:shadow-sm hover:border-primary/30"
    >
      <div className="flex items-start gap-3">
        <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <PawPrint className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold">{livestock.name}</h3>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            {livestock.species && <span>{livestock.species}</span>}
            {livestock.species && <span>·</span>}
            <span className="inline-flex items-center gap-1">
              <Wallet className="h-3 w-3" /> {livestock.totalCount} head
            </span>
            <span>·</span>
            <span>
              {livestock.activeBatchCount} batch
              {livestock.activeBatchCount === 1 ? "" : "es"}
            </span>
          </div>
          {livestock.description && (
            <p className="mt-1.5 line-clamp-2 text-[11px] text-muted-foreground">
              {livestock.description}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            onClick={stop(onEdit)}
            aria-label="Edit"
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={stop(onDelete)}
            aria-label="Delete"
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </div>
      <span className="mt-3 inline-flex items-center gap-1 text-[11px] text-muted-foreground group-hover:text-foreground">
        Open batches <ArrowRight className="h-3 w-3" />
      </span>
    </NavigatingCard>
  );
}

function KpiCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-base font-semibold tabular-nums">{value}</div>
      {hint && (
        <div className="mt-0.5 text-[10px] text-muted-foreground line-clamp-1">
          {hint}
        </div>
      )}
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
      const res = await fetch(
        livestock ? `/api/livestock/${livestock.id}` : "/api/livestock",
        {
          method: livestock ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
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
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {livestock ? "Edit livestock" : "New livestock"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              maxLength={80}
              placeholder="e.g. Broiler chicken, Dairy cow, Country chicken"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Species (optional)</Label>
            <Input
              value={species}
              onChange={(e) => setSpecies(e.target.value)}
              placeholder="e.g. poultry, bovine, caprine"
              maxLength={40}
            />
          </div>
          <DescriptionField
            value={description}
            onChange={setDescription}
            maxLength={500}
            placeholder="What you raise this for, breed details, anything worth remembering."
            rows={3}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting || !name.trim()}>
            {livestock ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
