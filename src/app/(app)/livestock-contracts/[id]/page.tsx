"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  Calendar,
  HandCoins,
  Layers,
  Pencil,
  Trash2,
  TrendingUp,
  UserCircle,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatINR } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AttachmentList } from "@/components/attachments/attachment-list";
import { ContractFormDialog } from "@/components/livestock/contract-form-dialog";
import { formatDate } from "@/lib/utils";
import { fetcher } from "@/lib/swr-fetcher";

type ContractDetail = {
  contract: {
    id: string;
    contactId: string | null;
    contactName: string | null;
    integratorName: string;
    contractRef: string | null;
    agreedRatePerKg: number;
    fcrBonusBands: unknown;
    mortalityCap: number | null;
    mortalityPenalty: unknown;
    suppliesProvided: string[];
    notes: string | null;
    startedOn: string;
    endedOn: string | null;
    batches: {
      id: string;
      name: string;
      active: boolean;
      currentCount: number;
      startDate: string;
    }[];
    payouts: {
      id: string;
      date: string;
      amount: number;
      batchId: string | null;
      batchName: string;
    }[];
    totalPaidOut: number;
  };
};

type FcrBand = { maxFcr: number; bonusPerKg: number };
type MortalityBand = { overByPct: number; deductPerKg: number };

function asFcrBands(v: unknown): FcrBand[] {
  return Array.isArray(v)
    ? (v.filter(
        (b): b is FcrBand =>
          typeof b === "object" &&
          b !== null &&
          typeof (b as FcrBand).maxFcr === "number" &&
          typeof (b as FcrBand).bonusPerKg === "number",
      ) as FcrBand[])
    : [];
}
function asMortalityBands(v: unknown): MortalityBand[] {
  return Array.isArray(v)
    ? (v.filter(
        (b): b is MortalityBand =>
          typeof b === "object" &&
          b !== null &&
          typeof (b as MortalityBand).overByPct === "number" &&
          typeof (b as MortalityBand).deductPerKg === "number",
      ) as MortalityBand[])
    : [];
}

export default function ContractDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const detailKey = `/api/livestock-contracts/${id}`;
  const { data, isLoading, error } = useSWR<ContractDetail>(detailKey, fetcher);
  const [editOpen, setEditOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-24" />
        <Skeleton className="h-48" />
      </div>
    );
  }
  if (error || !data?.contract) {
    return (
      <p className="text-sm text-muted-foreground">
        Contract not found.{" "}
        <Link href="/livestock" className="underline">
          Back to livestock
        </Link>
      </p>
    );
  }

  const c = data.contract;
  const fcrBands = asFcrBands(c.fcrBonusBands);
  const penaltyBands = asMortalityBands(c.mortalityPenalty);
  const activeBatches = c.batches.filter((b) => b.active);
  const closedBatches = c.batches.filter((b) => !b.active);
  const totalHead = activeBatches.reduce((s, b) => s + b.currentCount, 0);

  async function remove() {
    if (
      !confirm(
        "Delete this contract? Linked batches will lose the integrator link.",
      )
    )
      return;
    const res = await fetch(`/api/livestock-contracts/${id}`, {
      method: "DELETE",
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(body.error ?? "Failed to delete");
      return;
    }
    toast.success("Contract deleted");
    globalMutate("/api/livestock-contracts");
    router.push("/livestock");
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/livestock"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> Back to livestock
        </Link>
      </div>

      <header className="rounded-xl border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="text-[10px]">
                Broiler contract
              </Badge>
              {c.endedOn ? (
                <Badge variant="outline" className="text-[10px]">
                  Ended {formatDate(c.endedOn)}
                </Badge>
              ) : (
                <Badge className="bg-emerald-100 text-emerald-800 text-[10px] dark:bg-emerald-950 dark:text-emerald-300">
                  Active
                </Badge>
              )}
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <Calendar className="h-3 w-3" />
                Since {formatDate(c.startedOn)}
              </span>
              {c.contactName && (
                <Link
                  href={`/contacts/${c.contactId}`}
                  className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                >
                  <UserCircle className="h-3 w-3" />
                  {c.contactName}
                </Link>
              )}
            </div>
            <h1 className="mt-1.5 text-2xl font-semibold tracking-tight">
              {c.integratorName}
            </h1>
            {c.contractRef && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {c.contractRef}
              </p>
            )}
            {c.notes && (
              <p className="mt-2 max-w-2xl whitespace-pre-wrap text-sm text-muted-foreground">
                {c.notes}
              </p>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditOpen(true)}
              className="gap-1"
            >
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={remove}
              title="Delete contract"
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          icon={<HandCoins className="h-3.5 w-3.5" />}
          label="Base rate"
          value={`₹${c.agreedRatePerKg.toFixed(2)}/kg`}
        />
        <KpiCard
          icon={<Layers className="h-3.5 w-3.5" />}
          label="Active batches"
          value={`${activeBatches.length}`}
          hint={
            activeBatches.length > 0
              ? `${totalHead} head live`
              : "No active flocks"
          }
        />
        <KpiCard
          label="Closed batches"
          value={`${closedBatches.length}`}
          hint={closedBatches.length > 0 ? "Historical" : undefined}
        />
        <KpiCard
          label="Mortality cap"
          value={c.mortalityCap != null ? `${c.mortalityCap.toFixed(2)}%` : "—"}
          hint={
            penaltyBands.length > 0
              ? `${penaltyBands.length} penalty band${penaltyBands.length === 1 ? "" : "s"}`
              : "No penalty configured"
          }
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border bg-card p-4">
          <h2 className="text-sm font-semibold">FCR bonus structure</h2>
          {fcrBands.length === 0 ? (
            <p className="mt-2 text-[11px] text-muted-foreground">
              No bonus configured — flat ₹{c.agreedRatePerKg.toFixed(2)}/kg
              applies regardless of FCR.
            </p>
          ) : (
            <ul className="mt-2 divide-y rounded-lg border">
              {[...fcrBands]
                .sort((a, b) => a.maxFcr - b.maxFcr)
                .map((b, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between px-3 py-2 text-xs"
                  >
                    <span>
                      <span className="font-medium">FCR ≤ {b.maxFcr}</span>
                      <span className="ml-1.5 text-muted-foreground">
                        first match wins
                      </span>
                    </span>
                    <span className="font-medium tabular-nums text-emerald-700 dark:text-emerald-400">
                      +₹{b.bonusPerKg.toFixed(2)}/kg
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl border bg-card p-4">
          <h2 className="text-sm font-semibold">Mortality penalty</h2>
          {penaltyBands.length === 0 ? (
            <p className="mt-2 text-[11px] text-muted-foreground">
              No penalty configured.
            </p>
          ) : (
            <ul className="mt-2 divide-y rounded-lg border">
              {[...penaltyBands]
                .sort((a, b) => b.overByPct - a.overByPct)
                .map((p, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between px-3 py-2 text-xs"
                  >
                    <span>
                      <span className="font-medium">
                        Over cap by ≥ {p.overByPct}%
                      </span>
                    </span>
                    <span className="font-medium tabular-nums text-destructive">
                      −₹{p.deductPerKg.toFixed(2)}/kg
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </div>
      </section>

      {c.suppliesProvided.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold">Integrator provides</h2>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {c.suppliesProvided.map((s) => (
              <Badge key={s} variant="secondary" className="text-[11px]">
                {s}
              </Badge>
            ))}
          </div>
        </section>
      )}

      {c.payouts.length > 0 && (
        <section className="rounded-xl border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold">
              <TrendingUp className="h-3.5 w-3.5" /> Payout history
            </h2>
            <span className="text-[10px] text-muted-foreground">
              {c.payouts.length} lift{c.payouts.length === 1 ? "" : "s"} ·{" "}
              {formatINR(c.totalPaidOut)} lifetime
            </span>
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={c.payouts.map((p) => ({
                  date: p.date,
                  amount: p.amount,
                  label: new Date(p.date).toLocaleDateString("en-IN", {
                    day: "2-digit",
                    month: "short",
                    year: "2-digit",
                  }),
                  batchName: p.batchName,
                }))}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                <XAxis
                  dataKey="label"
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) =>
                    v >= 100000
                      ? `₹${(v / 100000).toFixed(1)}L`
                      : v >= 1000
                        ? `₹${Math.round(v / 1000)}k`
                        : `₹${v}`
                  }
                />
                <Tooltip
                  formatter={(v) => formatINR(Number(v))}
                  labelFormatter={(label, payload) => {
                    const p = payload?.[0]?.payload as
                      | { batchName: string }
                      | undefined;
                    return p?.batchName
                      ? `${label} · ${p.batchName}`
                      : String(label);
                  }}
                  contentStyle={{ fontSize: 11, borderRadius: 6 }}
                />
                <Bar
                  dataKey="amount"
                  fill="#10b981"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      <section className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Batches</h2>
          {c.batches.length > 0 && (
            <span className="text-[10px] text-muted-foreground">
              {c.batches.length} total · {activeBatches.length} active
            </span>
          )}
        </div>
        {c.batches.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-card p-6 text-center text-xs text-muted-foreground">
            No batches grown under this contract yet. Create a new batch
            under any livestock kind with productionType = Broiler-contract
            and link this contract.
          </div>
        ) : (
          <ul className="divide-y rounded-xl border bg-card">
            {c.batches.map((b) => (
              <BatchListItem key={b.id} batch={b} />
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Documents</h2>
        <AttachmentList
          ownerKind="LIVESTOCK_CONTRACT_DOCUMENT"
          ownerId={c.id}
          emptyMessage="No documents yet. Upload the signed contract, partner agreement, or any related paperwork."
          accept="image/*,application/pdf"
        />
      </section>

      <ContractFormDialog
        key={`edit-${editOpen}`}
        open={editOpen}
        onOpenChange={setEditOpen}
        initial={c}
        onSaved={() => {
          globalMutate(detailKey);
          globalMutate("/api/livestock-contracts");
        }}
      />
    </div>
  );
}

function BatchListItem({
  batch,
}: {
  batch: ContractDetail["contract"]["batches"][number];
}) {
  // The contract endpoint doesn't carry the parent livestockId on the
  // batch (the FK is on LivestockBatch.livestockId). We look it up via
  // a per-row SWR so each link can deep-jump to the correct route.
  // Single fetch per page since the underlying batch endpoint is cached.
  const { data } = useSWR<{ batch: { livestockId: string } }>(
    `/api/livestock-batches/${batch.id}`,
    fetcher,
  );
  const livestockId = data?.batch.livestockId;

  return (
    <li className="px-3 py-2">
      {livestockId ? (
        <Link
          href={`/livestock/${livestockId}/batches/${batch.id}`}
          className="flex items-center justify-between gap-3 hover:bg-muted/40 -mx-3 px-3 py-1 rounded"
        >
          <Row batch={batch} />
          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </Link>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <Row batch={batch} />
        </div>
      )}
    </li>
  );
}

function Row({
  batch,
}: {
  batch: ContractDetail["contract"]["batches"][number];
}) {
  return (
    <>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{batch.name}</span>
          {batch.active ? (
            <Badge className="bg-emerald-100 text-emerald-800 text-[10px] dark:bg-emerald-950 dark:text-emerald-300">
              Active
            </Badge>
          ) : (
            <Badge variant="secondary" className="text-[10px]">
              Closed
            </Badge>
          )}
        </div>
        <div className="text-[10px] text-muted-foreground">
          {formatDate(batch.startDate)} · {batch.currentCount} head
        </div>
      </div>
    </>
  );
}

function KpiCard({
  icon,
  label,
  value,
  hint,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        {icon}
        <span>{label}</span>
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
