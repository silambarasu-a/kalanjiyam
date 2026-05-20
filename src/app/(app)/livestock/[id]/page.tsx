"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR, { mutate as globalMutate } from "swr";
import {
  ArrowLeft,
  ArrowRight,
  Plus,
  Stethoscope,
  Utensils,
  Wallet,
  Activity,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DateInput } from "@/components/ui/date-input";
import { AmountInput } from "@/components/ui/amount-input";
import { NativeSelect } from "@/components/ui/native-select";
import { DescriptionField } from "@/components/ui/description-field";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ContractFormDialog } from "@/components/livestock/contract-form-dialog";
import { mutateBalances } from "@/lib/mutate-balances";
import { formatDate, groupAccountOptions } from "@/lib/utils";
import { fetcher } from "@/lib/swr-fetcher";

type ProductionType =
  | "BROILER_CONTRACT"
  | "BROILER_INDEPENDENT"
  | "LAYER"
  | "COUNTRY_CHICKEN"
  | "DAIRY"
  | "MEAT_GOAT"
  | "MEAT_SHEEP"
  | "DUAL_PURPOSE";

type Batch = {
  id: string;
  name: string;
  productionType: ProductionType;
  contractId: string | null;
  startDate: string;
  endDate: string | null;
  expectedCycleDays: number | null;
  initialCount: number;
  currentCount: number;
  initialAvgWeight: number | null;
  targetWeight: number | null;
  targetFCR: number | null;
  notes: string | null;
  active: boolean;
  livestock: { id: string; name: string };
};

type Account = {
  id: string;
  name: string;
  kind: string;
  balance: number;
  availableLimit: number | null;
};

type ContractRow = {
  id: string;
  integratorName: string;
  contractRef: string | null;
};

type Land = {
  id: string;
  name: string;
  area: number | null;
  areaUnit: string | null;
};

const PRODUCTION_TYPES: {
  value: ProductionType;
  label: string;
  desc: string;
  defaultCycle?: number;
  wantsWeight: boolean;
  wantsContract: boolean;
}[] = [
  {
    value: "BROILER_CONTRACT",
    label: "Broiler (contract)",
    desc: "Suguna / Sakthi / Venky's etc. provide chicks + feed; integrator lifts at exit.",
    defaultCycle: 42,
    wantsWeight: true,
    wantsContract: true,
  },
  {
    value: "BROILER_INDEPENDENT",
    label: "Broiler (independent)",
    desc: "You buy chicks, feed, and sell directly to market.",
    defaultCycle: 45,
    wantsWeight: true,
    wantsContract: false,
  },
  {
    value: "LAYER",
    label: "Layer flock",
    desc: "Commercial egg birds — long-cycle, daily egg collection.",
    defaultCycle: 500,
    wantsWeight: false,
    wantsContract: false,
  },
  {
    value: "COUNTRY_CHICKEN",
    label: "Country chicken",
    desc: "Naattu kozhi — meat + eggs, free-range, slower growth.",
    defaultCycle: 150,
    wantsWeight: true,
    wantsContract: false,
  },
  {
    value: "DAIRY",
    label: "Dairy",
    desc: "Cow / buffalo — milk income, open-ended cycle.",
    wantsWeight: false,
    wantsContract: false,
  },
  {
    value: "MEAT_GOAT",
    label: "Goat (meat)",
    desc: "Mutton goats — weight-based sale.",
    wantsWeight: true,
    wantsContract: false,
  },
  {
    value: "MEAT_SHEEP",
    label: "Sheep (meat)",
    desc: "Mutton sheep — weight-based sale.",
    wantsWeight: true,
    wantsContract: false,
  },
  {
    value: "DUAL_PURPOSE",
    label: "Other / dual-purpose",
    desc: "Mixed or breeding stock — minimum fields, customise as you go.",
    wantsWeight: false,
    wantsContract: false,
  },
];

const PRODUCTION_LABEL: Record<ProductionType, string> = Object.fromEntries(
  PRODUCTION_TYPES.map((p) => [p.value, p.label]),
) as Record<ProductionType, string>;

export default function LivestockDetailPage() {
  const params = useParams<{ id: string }>();
  const livestockId = params?.id ?? "";

  const { data: parentRes } = useSWR<{
    livestock: { id: string; name: string; species: string | null };
  }>(livestockId ? `/api/livestock/${livestockId}` : null, fetcher);
  const { data: batchesRes, isLoading } = useSWR<{ batches: Batch[] }>(
    livestockId
      ? `/api/livestock-batches?livestockId=${livestockId}&active=false`
      : null,
    fetcher,
  );

  const [tab, setTab] = useState<"active" | "closed">("active");
  const [createBatchOpen, setCreateBatchOpen] = useState(false);
  const [actionBatch, setActionBatch] = useState<{
    batch: Batch;
    tab: "event" | "feed" | "vaccination";
  } | null>(null);

  const batches = batchesRes?.batches ?? [];
  const active = batches.filter((b) => b.active);
  const closed = batches.filter((b) => !b.active);
  const visible = tab === "active" ? active : closed;

  const totalHead = active.reduce((s, b) => s + b.currentCount, 0);
  const totalBatches = active.length;
  const totalContract = active.filter(
    (b) => b.productionType === "BROILER_CONTRACT",
  ).length;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/livestock"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> All livestock
        </Link>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {parentRes?.livestock?.name ?? "…"}
            </h1>
            {parentRes?.livestock?.species && (
              <p className="mt-1 text-sm text-muted-foreground">
                {parentRes.livestock.species}
              </p>
            )}
          </div>
          <Button onClick={() => setCreateBatchOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" /> New batch
          </Button>
        </div>
      </div>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Active batches" value={`${totalBatches}`} />
        <KpiCard label="Live head" value={`${totalHead}`} />
        <KpiCard
          label="Contract batches"
          value={`${totalContract}`}
          hint={
            totalContract > 0 ? "Suguna / Sakthi-style growing" : undefined
          }
        />
        <KpiCard label="Closed history" value={`${closed.length}`} />
      </section>

      <div className="flex items-center gap-2">
        <div className="flex rounded-md border bg-card p-0.5 text-[11px]">
          <button
            type="button"
            onClick={() => setTab("active")}
            className={`rounded px-3 py-1 transition-colors ${
              tab === "active"
                ? "bg-muted font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Active ({active.length})
          </button>
          <button
            type="button"
            onClick={() => setTab("closed")}
            className={`rounded px-3 py-1 transition-colors ${
              tab === "closed"
                ? "bg-muted font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Closed ({closed.length})
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card p-10 text-center">
          <p className="text-sm font-medium">
            {tab === "active" ? "No active batches." : "No closed batches."}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {tab === "active"
              ? "Create your first batch to start tracking head count, feed, and P&L."
              : "Closed batches stay here for history. They won't count toward the active head."}
          </p>
          {tab === "active" && (
            <Button
              onClick={() => setCreateBatchOpen(true)}
              className="mt-4 gap-2"
            >
              <Plus className="h-4 w-4" /> New batch
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {visible.map((b) => (
            <BatchCard
              key={b.id}
              batch={b}
              onRecordEvent={() =>
                setActionBatch({ batch: b, tab: "event" })
              }
              onLogFeed={() => setActionBatch({ batch: b, tab: "feed" })}
              onLogVaccination={() =>
                setActionBatch({ batch: b, tab: "vaccination" })
              }
            />
          ))}
        </div>
      )}

      <CreateBatchDialog
        key={`create-${createBatchOpen}`}
        livestockId={livestockId}
        open={createBatchOpen}
        onClose={() => setCreateBatchOpen(false)}
      />
      <BatchActionDialog
        batchAction={actionBatch}
        onClose={() => setActionBatch(null)}
      />
    </div>
  );
}

function BatchCard({
  batch,
  onRecordEvent,
  onLogFeed,
  onLogVaccination,
}: {
  batch: Batch;
  onRecordEvent: () => void;
  onLogFeed: () => void;
  onLogVaccination: () => void;
}) {
  const [nowMs] = useState(() => Date.now());
  const daysInCycle = Math.max(
    0,
    Math.floor((nowMs - new Date(batch.startDate).getTime()) / 86400000),
  );
  const progress =
    batch.expectedCycleDays && batch.expectedCycleDays > 0
      ? Math.min(100, Math.round((daysInCycle / batch.expectedCycleDays) * 100))
      : null;
  const headDelta = batch.initialCount - batch.currentCount;
  const mortalityHint =
    batch.initialCount > 0 && headDelta > 0
      ? `${((headDelta / batch.initialCount) * 100).toFixed(1)}% loss`
      : null;

  return (
    <div className="group rounded-xl border bg-card p-4 transition-shadow hover:shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary" className="text-[10px]">
              {PRODUCTION_LABEL[batch.productionType]}
            </Badge>
            {!batch.active && (
              <Badge variant="outline" className="text-[10px]">
                Closed
              </Badge>
            )}
            {batch.contractId && (
              <Badge className="bg-violet-100 text-violet-800 text-[10px] dark:bg-violet-950 dark:text-violet-300">
                Under contract
              </Badge>
            )}
          </div>
          <h3 className="mt-1.5 truncate text-base font-semibold">
            {batch.name}
          </h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Started {formatDate(batch.startDate)}
            {batch.expectedCycleDays
              ? ` · target ${batch.expectedCycleDays}d cycle`
              : ""}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-2xl font-semibold leading-none tabular-nums">
            {batch.currentCount}
          </div>
          <div className="mt-0.5 text-[10px] text-muted-foreground">
            of {batch.initialCount}
          </div>
          {mortalityHint && (
            <div className="mt-0.5 text-[10px] text-amber-700 dark:text-amber-400">
              {mortalityHint}
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
        <MiniMetric
          label="Day"
          value={`${daysInCycle}${batch.expectedCycleDays ? ` / ${batch.expectedCycleDays}` : ""}`}
        />
        <MiniMetric
          label="Arrival kg"
          value={
            batch.initialAvgWeight != null
              ? `${batch.initialAvgWeight} kg`
              : "—"
          }
        />
        <MiniMetric
          label="Target kg"
          value={batch.targetWeight != null ? `${batch.targetWeight} kg` : "—"}
        />
      </div>

      {progress != null && (
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full ${progress >= 100 ? "bg-amber-500" : "bg-primary"}`}
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Button
          size="sm"
          variant="outline"
          className="gap-1"
          onClick={onRecordEvent}
        >
          <Activity className="h-3.5 w-3.5" /> Event
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-1"
          onClick={onLogFeed}
        >
          <Utensils className="h-3.5 w-3.5" /> Feed
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-1"
          onClick={onLogVaccination}
        >
          <Stethoscope className="h-3.5 w-3.5" /> Vaccine
        </Button>
        <Link
          href={`/livestock/${batch.livestock.id}/batches/${batch.id}`}
          className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          Details <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/30 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-xs font-medium tabular-nums">{value}</div>
    </div>
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
        <div className="mt-0.5 text-[10px] text-muted-foreground">{hint}</div>
      )}
    </div>
  );
}

function CreateBatchDialog({
  livestockId,
  open,
  onClose,
}: {
  livestockId: string;
  open: boolean;
  onClose: () => void;
}) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const { data: contractsRes } = useSWR<{ contracts: ContractRow[] }>(
    open ? "/api/livestock-contracts" : null,
    fetcher,
  );
  const { data: landsRes } = useSWR<{ lands: Land[] }>(
    open ? "/api/land" : null,
    fetcher,
  );

  const [productionType, setProductionType] =
    useState<ProductionType>("DUAL_PURPOSE");
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState(today);
  const [initialCount, setInitialCount] = useState("0");
  const [expectedCycleDays, setExpectedCycleDays] = useState("");
  const [initialAvgWeight, setInitialAvgWeight] = useState("");
  const [targetWeight, setTargetWeight] = useState("");
  const [targetFCR, setTargetFCR] = useState("");
  const [contractId, setContractId] = useState("");
  const [landId, setLandId] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contractDialogOpen, setContractDialogOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- reset on open */
    setProductionType("DUAL_PURPOSE");
    setName("");
    setStartDate(today);
    setInitialCount("0");
    setExpectedCycleDays("");
    setInitialAvgWeight("");
    setTargetWeight("");
    setTargetFCR("");
    setContractId("");
    setLandId("");
    setNotes("");
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, today]);

  const meta =
    PRODUCTION_TYPES.find((p) => p.value === productionType) ??
    PRODUCTION_TYPES[PRODUCTION_TYPES.length - 1];

  function pickType(next: ProductionType) {
    const m = PRODUCTION_TYPES.find((p) => p.value === next);
    setProductionType(next);
    if (m?.defaultCycle && !expectedCycleDays) {
      setExpectedCycleDays(String(m.defaultCycle));
    }
  }

  async function submit() {
    setError(null);
    if (!name.trim()) return setError("Name is required");
    if (meta.wantsContract && !contractId)
      return setError("Pick a contract — broiler-contract batches need one");
    setSubmitting(true);
    try {
      const res = await fetch("/api/livestock-batches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          livestockId,
          name: name.trim(),
          productionType,
          contractId: contractId || undefined,
          landId: landId || undefined,
          startDate,
          initialCount: Number(initialCount) || 0,
          expectedCycleDays: expectedCycleDays
            ? Number(expectedCycleDays)
            : null,
          initialAvgWeight: initialAvgWeight
            ? Number(initialAvgWeight)
            : null,
          targetWeight: targetWeight ? Number(targetWeight) : null,
          targetFCR: targetFCR ? Number(targetFCR) : null,
          notes: notes.trim() || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Failed");
        return;
      }
      globalMutate(
        `/api/livestock-batches?livestockId=${livestockId}&active=false`,
      );
      globalMutate("/api/livestock");
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New batch</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-xs">Production type</Label>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Drives which fields you need to fill in and which tabs the
              detail page shows.
            </p>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {PRODUCTION_TYPES.map((p) => {
                const active = productionType === p.value;
                return (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => pickType(p.value)}
                    className={`rounded-lg border p-2.5 text-left text-xs transition-colors ${
                      active
                        ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                        : "border-input bg-card hover:border-input/80"
                    }`}
                  >
                    <div className="text-xs font-medium">{p.label}</div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground line-clamp-2">
                      {p.desc}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Batch name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              maxLength={80}
              placeholder="e.g. Batch-Apr-2026, Shed-A round 12"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Start date</Label>
              <DateInput
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Initial count</Label>
              <Input
                inputMode="numeric"
                value={initialCount}
                onChange={(e) =>
                  setInitialCount(e.target.value.replace(/\D/g, "").slice(0, 7))
                }
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">
              Expected cycle (days){" "}
              <span className="font-normal text-muted-foreground">
                {meta.defaultCycle ? `· typical ~${meta.defaultCycle}` : ""}
              </span>
            </Label>
            <Input
              inputMode="numeric"
              value={expectedCycleDays}
              onChange={(e) =>
                setExpectedCycleDays(
                  e.target.value.replace(/\D/g, "").slice(0, 4),
                )
              }
              placeholder={meta.defaultCycle ? String(meta.defaultCycle) : ""}
            />
          </div>

          {meta.wantsWeight && (
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Arrival wt (kg/bird)</Label>
                <Input
                  inputMode="decimal"
                  value={initialAvgWeight}
                  onChange={(e) =>
                    setInitialAvgWeight(
                      e.target.value.replace(/[^\d.]/g, "").slice(0, 8),
                    )
                  }
                  placeholder="0.045"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Target exit wt (kg)</Label>
                <Input
                  inputMode="decimal"
                  value={targetWeight}
                  onChange={(e) =>
                    setTargetWeight(
                      e.target.value.replace(/[^\d.]/g, "").slice(0, 8),
                    )
                  }
                  placeholder="2.20"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Target FCR</Label>
                <Input
                  inputMode="decimal"
                  value={targetFCR}
                  onChange={(e) =>
                    setTargetFCR(
                      e.target.value.replace(/[^\d.]/g, "").slice(0, 6),
                    )
                  }
                  placeholder="1.70"
                />
              </div>
            </div>
          )}

          {meta.wantsContract && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Integrator contract</Label>
                <button
                  type="button"
                  onClick={() => setContractDialogOpen(true)}
                  className="text-[11px] text-primary hover:underline"
                >
                  + New contract
                </button>
              </div>
              <NativeSelect
                value={contractId}
                onChange={setContractId}
                placeholder="— pick a contract —"
                options={(contractsRes?.contracts ?? []).map((c) => ({
                  value: c.id,
                  label: c.contractRef
                    ? `${c.integratorName} · ${c.contractRef}`
                    : c.integratorName,
                }))}
                searchable
              />
              <p className="text-[10px] text-muted-foreground">
                Drives the expected-payout estimator on the batch detail page.
              </p>
            </div>
          )}

          {(landsRes?.lands ?? []).length > 0 && (
            <div className="space-y-1">
              <Label className="text-xs">
                Shed / land{" "}
                <span className="font-normal text-muted-foreground">
                  (optional · groups batches by location)
                </span>
              </Label>
              <NativeSelect
                value={landId}
                onChange={setLandId}
                placeholder="— no land link —"
                options={[
                  { value: "", label: "— no land link —" },
                  ...(landsRes?.lands ?? []).map((l) => ({
                    value: l.id,
                    label:
                      l.area != null && l.areaUnit
                        ? `${l.name} · ${l.area} ${l.areaUnit}`
                        : l.name,
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
            placeholder="Shed, supplier, anything worth recording…"
            maxLength={500}
            rows={2}
          />

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={submitting || !name.trim()}
          >
            {submitting ? "Creating…" : "Create batch"}
          </Button>
        </DialogFooter>

        <ContractFormDialog
          key={`contract-${contractDialogOpen}`}
          open={contractDialogOpen}
          onOpenChange={setContractDialogOpen}
          onSaved={(newId) => {
            globalMutate("/api/livestock-contracts");
            if (newId) setContractId(newId);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function BatchActionDialog({
  batchAction,
  onClose,
}: {
  batchAction: { batch: Batch; tab: "event" | "feed" | "vaccination" } | null;
  onClose: () => void;
}) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const { data: accountsData } = useSWR<{ accounts: Account[] }>(
    batchAction ? "/api/accounts" : null,
    fetcher,
  );
  const accounts = (accountsData?.accounts ?? []).filter(
    (a) => a.kind !== "CARD",
  );

  const [eventType, setEventType] = useState<
    "PURCHASE" | "BIRTH" | "DEATH" | "SALE"
  >("BIRTH");
  const [count, setCount] = useState("1");
  const [unitValue, setUnitValue] = useState("");
  const [avgWeightKg, setAvgWeightKg] = useState("");
  const [feedAmount, setFeedAmount] = useState("");
  const [feedQuantity, setFeedQuantity] = useState("");
  const [feedUnit, setFeedUnit] = useState("");
  const [vaccine, setVaccine] = useState("");
  const [nextDueDate, setNextDueDate] = useState("");
  const [vaccinationCost, setVaccinationCost] = useState("");
  const [date, setDate] = useState(today);
  const [accountId, setAccountId] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!batchAction) return;
    /* eslint-disable react-hooks/set-state-in-effect -- reset on open */
    setEventType("BIRTH");
    setCount("1");
    setUnitValue("");
    setAvgWeightKg("");
    setFeedAmount("");
    setFeedQuantity("");
    setFeedUnit("");
    setVaccine("");
    setNextDueDate("");
    setVaccinationCost("");
    setDate(today);
    setAccountId("");
    setNotes("");
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [batchAction, today]);

  if (!batchAction) return null;
  const { batch, tab } = batchAction;

  const isFinancial =
    (tab === "event" && (eventType === "SALE" || eventType === "PURCHASE")) ||
    tab === "feed" ||
    (tab === "vaccination" && Number(vaccinationCost) > 0);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      let url = "";
      let payload: Record<string, unknown> = {};
      if (tab === "event") {
        url = `/api/livestock-batches/${batch.id}/events`;
        payload = {
          eventType,
          date,
          count: Number(count) || 0,
          unitValue: unitValue ? Number(unitValue) : null,
          avgWeightKg: avgWeightKg ? Number(avgWeightKg) : null,
          notes: notes.trim() || undefined,
          accountId: accountId || undefined,
        };
      } else if (tab === "feed") {
        url = `/api/livestock-batches/${batch.id}/feed`;
        payload = {
          date,
          amount: Number(feedAmount) || 0,
          quantity: feedQuantity ? Number(feedQuantity) : null,
          unit: feedUnit || undefined,
          notes: notes.trim() || undefined,
          accountId: accountId || undefined,
        };
      } else {
        url = `/api/livestock-batches/${batch.id}/vaccination`;
        payload = {
          vaccine,
          date,
          nextDueDate: nextDueDate || null,
          cost: vaccinationCost ? Number(vaccinationCost) : null,
          notes: notes.trim() || undefined,
          accountId: accountId || undefined,
        };
      }
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Failed");
        return;
      }
      globalMutate(
        `/api/livestock-batches?livestockId=${batch.livestock.id}&active=false`,
      );
      globalMutate("/api/livestock");
      await mutateBalances();
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  const showAvgWeight =
    tab === "event" &&
    (eventType === "PURCHASE" || eventType === "SALE");

  return (
    <Dialog open={batchAction !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {tab === "event" ? (
              <span className="inline-flex items-center gap-2">
                <Activity className="h-4 w-4" /> {batch.name} · Event
              </span>
            ) : tab === "feed" ? (
              <span className="inline-flex items-center gap-2">
                <Utensils className="h-4 w-4" /> {batch.name} · Feed
              </span>
            ) : (
              <span className="inline-flex items-center gap-2">
                <Stethoscope className="h-4 w-4" /> {batch.name} · Vaccination
              </span>
            )}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {tab === "event" && (
            <>
              <div className="flex flex-wrap gap-1.5">
                {(["BIRTH", "DEATH", "SALE", "PURCHASE"] as const).map((e) => (
                  <Button
                    key={e}
                    type="button"
                    size="sm"
                    variant={eventType === e ? "default" : "outline"}
                    onClick={() => setEventType(e)}
                  >
                    {e}
                  </Button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Count</Label>
                  <Input
                    inputMode="numeric"
                    value={count}
                    onChange={(e) =>
                      setCount(e.target.value.replace(/\D/g, "").slice(0, 6))
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Date</Label>
                  <DateInput
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </div>
              </div>
              {(eventType === "SALE" || eventType === "PURCHASE") && (
                <div className="space-y-1">
                  <Label className="text-xs">Unit value (₹)</Label>
                  <AmountInput
                    value={unitValue}
                    onChange={setUnitValue}
                    placeholder="Per animal"
                  />
                </div>
              )}
              {showAvgWeight && (
                <div className="space-y-1">
                  <Label className="text-xs">
                    Avg weight per animal (kg, optional)
                  </Label>
                  <Input
                    inputMode="decimal"
                    value={avgWeightKg}
                    onChange={(e) =>
                      setAvgWeightKg(
                        e.target.value.replace(/[^\d.]/g, "").slice(0, 8),
                      )
                    }
                    placeholder="2.10"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Useful for FCR + contract payout math. Skip if you didn&rsquo;t
                    weigh.
                  </p>
                </div>
              )}
              <p className="text-[11px] text-muted-foreground">
                Current head: {batch.currentCount}. Birth/Purchase add, Death/Sale
                subtract.
              </p>
            </>
          )}
          {tab === "feed" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Cost (₹)</Label>
                  <AmountInput value={feedAmount} onChange={setFeedAmount} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Date</Label>
                  <DateInput
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">
                    Quantity{" "}
                    <span className="font-normal text-muted-foreground">
                      (drives FCR)
                    </span>
                  </Label>
                  <AmountInput
                    value={feedQuantity}
                    onChange={setFeedQuantity}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Unit</Label>
                  <Input
                    value={feedUnit}
                    onChange={(e) => setFeedUnit(e.target.value)}
                    placeholder="kg, bag, sack…"
                    maxLength={20}
                  />
                </div>
              </div>
            </>
          )}
          {tab === "vaccination" && (
            <>
              <div className="space-y-1">
                <Label className="text-xs">Vaccine</Label>
                <Input
                  value={vaccine}
                  onChange={(e) => setVaccine(e.target.value)}
                  maxLength={80}
                  placeholder="Newcastle, Gumboro, FMD…"
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
                  <Label className="text-xs">Next due date</Label>
                  <DateInput
                    value={nextDueDate}
                    onChange={(e) => setNextDueDate(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Cost (₹, optional)</Label>
                <AmountInput
                  value={vaccinationCost}
                  onChange={setVaccinationCost}
                />
              </div>
            </>
          )}

          {isFinancial &&
            (() => {
              const isOutflow =
                (tab === "event" && eventType === "PURCHASE") ||
                tab === "feed" ||
                tab === "vaccination";
              const debitAmount = !isOutflow
                ? 0
                : tab === "feed"
                  ? Number(feedAmount) || 0
                  : tab === "vaccination"
                    ? Number(vaccinationCost) || 0
                    : (Number(count) || 0) * (Number(unitValue) || 0);
              return (
                <div className="space-y-1">
                  <Label className="text-xs inline-flex items-center gap-1">
                    <Wallet className="h-3 w-3" /> Pay from / receive into
                  </Label>
                  <NativeSelect
                    value={accountId}
                    onChange={setAccountId}
                    options={groupAccountOptions(accounts, debitAmount)}
                    searchable
                  />
                </div>
              );
            })()}

          <DescriptionField
            label="Notes"
            value={notes}
            onChange={setNotes}
            placeholder="Optional notes…"
            maxLength={500}
            rows={2}
          />

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
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
