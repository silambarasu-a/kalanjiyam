"use client";

import Link from "next/link";
import { use, useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import {
  Activity,
  ArrowLeft,
  Calendar,
  CalendarClock,
  CheckCircle2,
  Droplets,
  Egg,
  Gauge,
  Pencil,
  RotateCcw,
  HeartPulse,
  MapPin,
  PawPrint,
  Plus,
  Scale,
  Skull,
  Stethoscope,
  Truck,
  Users,
  Wallet,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { AttachmentList } from "@/components/attachments/attachment-list";
import { LogWeighingDialog } from "@/components/livestock/log-weighing-dialog";
import { LogMortalityDialog } from "@/components/livestock/log-mortality-dialog";
import { AnimalFormDialog } from "@/components/livestock/animal-form-dialog";
import { LogMilkDialog } from "@/components/livestock/log-milk-dialog";
import { LogEggDialog } from "@/components/livestock/log-egg-dialog";
import { LogHealthDialog } from "@/components/livestock/log-health-dialog";
import { RecordLiftDialog } from "@/components/livestock/record-lift-dialog";
import { CloseBatchDialog } from "@/components/livestock/close-batch-dialog";
import { EditBatchDialog } from "@/components/livestock/edit-batch-dialog";
import { EditVaccinationDialog } from "@/components/livestock/edit-vaccination-dialog";
import { EditFeedDialog } from "@/components/livestock/edit-feed-dialog";
import { formatINR, formatDate } from "@/lib/utils";
import { fetcher } from "@/lib/swr-fetcher";

type BatchDetail = {
  batch: {
    id: string;
    name: string;
    productionType:
      | "BROILER_CONTRACT"
      | "BROILER_INDEPENDENT"
      | "LAYER"
      | "COUNTRY_CHICKEN"
      | "DAIRY"
      | "MEAT_GOAT"
      | "MEAT_SHEEP"
      | "DUAL_PURPOSE";
    contractId: string | null;
    contract: {
      id: string;
      integratorName: string;
      contractRef: string | null;
      agreedRatePerKg: number;
    } | null;
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
    livestockId: string;
    landId: string | null;
    land: {
      id: string;
      name: string;
      area: number | null;
      areaUnit: string | null;
    } | null;
  };
  summary: { income: number; expense: number; labor: number; net: number };
  events: {
    id: string;
    eventType: "PURCHASE" | "BIRTH" | "DEATH" | "SALE";
    date: string;
    count: number;
    unitValue: number | null;
    avgWeightKg: number | null;
    totalWeightKg: number | null;
    notes: string | null;
  }[];
  feedLogs: {
    id: string;
    date: string;
    amount: number;
    quantity: number | null;
    unit: string | null;
    notes: string | null;
  }[];
  vaccinations: {
    id: string;
    vaccine: string;
    date: string;
    nextDueDate: string | null;
    cost: number | null;
    notes: string | null;
  }[];
  weighings: {
    id: string;
    animalId: string | null;
    phase: "ARRIVAL" | "INTERIM" | "WEEKLY" | "EXIT";
    date: string;
    sampleSize: number;
    totalKg: number;
    avgKg: number;
    notes: string | null;
  }[];
  mortality: {
    id: string;
    animalId: string | null;
    date: string;
    count: number;
    cause: string;
    culled: boolean;
    notes: string | null;
  }[];
  animals: {
    id: string;
    tagNumber: string;
    name: string | null;
    sex: "MALE" | "FEMALE" | "UNKNOWN";
    dob: string | null;
    breed: string | null;
    color: string | null;
    notes: string | null;
    active: boolean;
  }[];
  milkLogs: {
    id: string;
    animalId: string | null;
    date: string;
    totalLitres: number;
    sessions: unknown;
    fatPct: number | null;
    snfPct: number | null;
    soldLitres: number | null;
    ratePerLitre: number | null;
    transactionId: string | null;
    notes: string | null;
  }[];
  eggLogs: {
    id: string;
    date: string;
    collected: number;
    grades: unknown;
    broken: number | null;
    sold: number | null;
    salePricePerEgg: number | null;
    transactionId: string | null;
    notes: string | null;
  }[];
  healthLogs: {
    id: string;
    animalId: string | null;
    date: string;
    condition: string;
    treatment: string | null;
    cost: number | null;
    resolved: boolean;
    resolvedAt: string | null;
    transactionId: string | null;
    notes: string | null;
  }[];
};

type Analytics = {
  daysInCycle: number;
  liveHead: number;
  totalFeedKg: number;
  totalFeedSpend: number;
  liveWeightGainKg: number;
  latestAvgKg: number | null;
  fcr: number | null;
  adgGrams: number | null;
  totalDeaths: number;
  mortalityPct: number;
  warnings: {
    missingFeedQuantity: boolean;
    missingArrivalWeight: boolean;
    noWeighings: boolean;
  };
  contractPayout: {
    liftedWeightKg: number;
    basePayout: number;
    fcrBonusPerKg: number;
    fcrBonusAmount: number;
    mortalityPenaltyPerKg: number;
    mortalityPenaltyAmount: number;
    expectedPayout: number;
  } | null;
};

const PRODUCTION_LABEL: Record<BatchDetail["batch"]["productionType"], string> = {
  BROILER_CONTRACT: "Broiler · contract",
  BROILER_INDEPENDENT: "Broiler · independent",
  LAYER: "Layer",
  COUNTRY_CHICKEN: "Country chicken",
  DAIRY: "Dairy",
  MEAT_GOAT: "Goat (meat)",
  MEAT_SHEEP: "Sheep (meat)",
  DUAL_PURPOSE: "Dual-purpose",
};

const CAUSE_LABEL: Record<string, string> = {
  UNKNOWN: "Unknown",
  DISEASE: "Disease",
  PREDATOR: "Predator",
  INJURY: "Injury",
  HEAT: "Heat",
  COLD: "Cold",
  STAMPEDE: "Stampede",
  OTHER: "Other",
};

export default function BatchDetailPage({
  params,
}: {
  params: Promise<{ id: string; batchId: string }>;
}) {
  const { id: livestockId, batchId } = use(params);
  const detailKey = `/api/livestock-batches/${batchId}`;
  const analyticsKey = `/api/livestock-batches/${batchId}/analytics`;
  const { data, isLoading, error } = useSWR<BatchDetail>(detailKey, fetcher);
  const { data: analyticsData } = useSWR<{ analytics: Analytics }>(
    analyticsKey,
    fetcher,
  );
  const { data: parentData } = useSWR<{
    livestock: { id: string; name: string; species: string | null };
  }>(`/api/livestock/${livestockId}`, fetcher);

  const [eventFilter, setEventFilter] = useState<
    "ALL" | "PURCHASE" | "BIRTH" | "DEATH" | "SALE"
  >("ALL");
  const [weighingOpen, setWeighingOpen] = useState(false);
  const [mortalityOpen, setMortalityOpen] = useState(false);
  const [animalOpen, setAnimalOpen] = useState(false);
  const [milkOpen, setMilkOpen] = useState(false);
  const [eggOpen, setEggOpen] = useState(false);
  const [healthOpen, setHealthOpen] = useState(false);
  const [liftOpen, setLiftOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editVaccination, setEditVaccination] = useState<
    BatchDetail["vaccinations"][number] | null
  >(null);
  const [editFeed, setEditFeed] = useState<
    BatchDetail["feedLogs"][number] | null
  >(null);
  const [editMilk, setEditMilk] = useState<
    BatchDetail["milkLogs"][number] | null
  >(null);
  const [editEgg, setEditEgg] = useState<
    BatchDetail["eggLogs"][number] | null
  >(null);
  const [editHealth, setEditHealth] = useState<
    BatchDetail["healthLogs"][number] | null
  >(null);
  const [editWeighing, setEditWeighing] = useState<
    BatchDetail["weighings"][number] | null
  >(null);
  const [editMortality, setEditMortality] = useState<
    BatchDetail["mortality"][number] | null
  >(null);
  const [editAnimal, setEditAnimal] = useState<
    BatchDetail["animals"][number] | null
  >(null);
  const [nowMs] = useState(() => Date.now());

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-24" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (error || !data?.batch) {
    return (
      <p className="text-sm text-muted-foreground">
        Batch not found.{" "}
        <Link href={`/livestock/${livestockId}`} className="underline">
          Back to batches
        </Link>
      </p>
    );
  }

  const {
    batch,
    summary,
    events,
    feedLogs,
    vaccinations,
    weighings,
    mortality,
    animals,
    milkLogs,
    eggLogs,
    healthLogs,
  } = data;
  const openHealthCount = healthLogs.filter((h) => !h.resolved).length;
  const parent = parentData?.livestock;
  const analytics = analyticsData?.analytics;
  const isContract = batch.productionType === "BROILER_CONTRACT";
  const isDairy = batch.productionType === "DAIRY";
  const showEggs =
    batch.productionType === "LAYER" ||
    batch.productionType === "COUNTRY_CHICKEN";
  const showWeighingsTab = batch.productionType !== "LAYER" && batch.productionType !== "DAIRY";
  const showAnimalsTab =
    batch.productionType === "DAIRY" ||
    batch.productionType === "MEAT_GOAT" ||
    batch.productionType === "MEAT_SHEEP" ||
    batch.productionType === "DUAL_PURPOSE";

  const daysInCycle =
    analytics?.daysInCycle ??
    Math.max(
      0,
      Math.floor(
        (nowMs - new Date(batch.startDate).getTime()) / (1000 * 60 * 60 * 24),
      ),
    );
  const cycleProgress =
    batch.expectedCycleDays && batch.expectedCycleDays > 0
      ? Math.min(100, Math.round((daysInCycle / batch.expectedCycleDays) * 100))
      : null;
  const mortalityPct = analytics?.mortalityPct ?? 0;
  const totalDeaths = analytics?.totalDeaths ?? 0;

  const feedSeries = buildFeedSeries(feedLogs);
  const eventCountSeries = buildEventCountSeries(events);
  const weighingSeries = buildWeighingSeries(weighings);
  const milkSeries = buildMilkSeries(milkLogs, nowMs);
  const eggSeries = buildEggSeries(eggLogs, nowMs);
  const egg30dCutoff = nowMs - 30 * 86400000;
  const egg30dCollected = eggLogs
    .filter((e) => new Date(e.date).getTime() >= egg30dCutoff)
    .reduce((s, e) => s + e.collected, 0);
  const egg30dSold = eggLogs
    .filter((e) => new Date(e.date).getTime() >= egg30dCutoff)
    .reduce((s, e) => s + (e.sold ?? 0), 0);
  const egg30dRevenue = eggLogs
    .filter((e) => new Date(e.date).getTime() >= egg30dCutoff)
    .reduce(
      (s, e) => s + (e.sold ?? 0) * (e.salePricePerEgg ?? 0),
      0,
    );
  const hdPercent =
    egg30dCollected > 0 && batch.currentCount > 0
      ? (egg30dCollected /
          (batch.currentCount *
            Math.min(
              30,
              Math.max(
                1,
                eggLogs.filter(
                  (e) => new Date(e.date).getTime() >= egg30dCutoff,
                ).length,
              ),
            ))) *
        100
      : null;
  const milk30dCutoff = nowMs - 30 * 86400000;
  const milk30dLitres = milkLogs
    .filter((m) => new Date(m.date).getTime() >= milk30dCutoff)
    .reduce((s, m) => s + m.totalLitres, 0);
  const milk30dRevenue = milkLogs
    .filter((m) => new Date(m.date).getTime() >= milk30dCutoff)
    .reduce(
      (s, m) => s + (m.soldLitres ?? 0) * (m.ratePerLitre ?? 0),
      0,
    );
  const filteredEvents =
    eventFilter === "ALL"
      ? events
      : events.filter((e) => e.eventType === eventFilter);

  async function refresh() {
    await Promise.all([globalMutate(detailKey), globalMutate(analyticsKey)]);
  }

  async function deleteWeighing(id: string) {
    if (!confirm("Delete this weighing?")) return;
    const res = await fetch(
      `/api/livestock-batches/${batchId}/weighings/${id}`,
      { method: "DELETE" },
    );
    if (res.ok) refresh();
  }
  async function deleteMortality(id: string) {
    if (
      !confirm(
        "Delete this mortality record? The batch head count will be restored.",
      )
    )
      return;
    const res = await fetch(
      `/api/livestock-batches/${batchId}/mortality/${id}`,
      { method: "DELETE" },
    );
    if (res.ok) refresh();
  }
  async function deleteFeed(id: string) {
    if (
      !confirm(
        "Delete this feed log? Any linked expense transaction will be removed too.",
      )
    )
      return;
    const res = await fetch(
      `/api/livestock-batches/${batchId}/feed/${id}`,
      { method: "DELETE" },
    );
    if (res.ok) refresh();
  }
  async function deleteVaccination(id: string) {
    if (
      !confirm(
        "Delete this vaccination? Any linked expense + reminder will be removed too.",
      )
    )
      return;
    const res = await fetch(
      `/api/livestock-batches/${batchId}/vaccination/${id}`,
      { method: "DELETE" },
    );
    if (res.ok) refresh();
  }
  async function deleteHealth(id: string) {
    if (
      !confirm(
        "Delete this health log? Any linked expense transaction will be removed too.",
      )
    )
      return;
    const res = await fetch(
      `/api/livestock-batches/${batchId}/health/${id}`,
      { method: "DELETE" },
    );
    if (res.ok) refresh();
  }
  async function toggleHealthResolved(id: string, next: boolean) {
    const res = await fetch(
      `/api/livestock-batches/${batchId}/health/${id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          resolved: next,
          resolvedAt: next ? new Date().toISOString().slice(0, 10) : null,
        }),
      },
    );
    if (res.ok) refresh();
  }
  async function deleteEgg(id: string) {
    if (
      !confirm(
        "Delete this egg log? Any linked income transaction will be removed too.",
      )
    )
      return;
    const res = await fetch(
      `/api/livestock-batches/${batchId}/eggs/${id}`,
      { method: "DELETE" },
    );
    if (res.ok) refresh();
  }
  async function deleteMilk(id: string) {
    if (
      !confirm(
        "Delete this milk log? Any linked income transaction will be removed too.",
      )
    )
      return;
    const res = await fetch(
      `/api/livestock-batches/${batchId}/milk/${id}`,
      { method: "DELETE" },
    );
    if (res.ok) refresh();
  }
  async function deleteAnimal(id: string) {
    if (!confirm("Delete this animal? Inactive animals are kept for history.")) return;
    const res = await fetch(
      `/api/livestock-batches/${batchId}/animals/${id}`,
      { method: "DELETE" },
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(body.error ?? "Failed to delete");
      return;
    }
    refresh();
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/livestock/${livestockId}`}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> Back to{" "}
          {parent?.name ?? "batches"}
        </Link>
      </div>

      <header className="rounded-xl border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="text-[10px]">
                {PRODUCTION_LABEL[batch.productionType]}
              </Badge>
              {parent?.species && (
                <Badge variant="outline" className="text-[10px]">
                  {parent.species}
                </Badge>
              )}
              {batch.active ? (
                <Badge className="bg-emerald-100 text-emerald-800 text-[10px] dark:bg-emerald-950 dark:text-emerald-300">
                  Active
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-[10px]">
                  Closed
                </Badge>
              )}
              {batch.contract && (
                <Badge className="bg-violet-100 text-violet-800 text-[10px] dark:bg-violet-950 dark:text-violet-300">
                  {batch.contract.integratorName}
                </Badge>
              )}
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <Calendar className="h-3 w-3" />
                Started {formatDate(batch.startDate)}
              </span>
              {batch.endDate && (
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Calendar className="h-3 w-3" />
                  Ended {formatDate(batch.endDate)}
                </span>
              )}
              {batch.land && (
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  <MapPin className="h-3 w-3" />
                  {batch.land.name}
                  {batch.land.area != null && batch.land.areaUnit
                    ? ` · ${batch.land.area} ${batch.land.areaUnit}`
                    : ""}
                </span>
              )}
            </div>
            <h1 className="mt-1.5 text-2xl font-semibold tracking-tight">
              {batch.name}
            </h1>
            {batch.notes && (
              <p className="mt-2 max-w-2xl whitespace-pre-wrap text-sm text-muted-foreground">
                {batch.notes}
              </p>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="gap-1"
              onClick={() => setWeighingOpen(true)}
            >
              <Scale className="h-3.5 w-3.5" /> Weighing
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1"
              onClick={() => setMortalityOpen(true)}
            >
              <Skull className="h-3.5 w-3.5" /> Mortality
            </Button>
            {showAnimalsTab && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1"
                onClick={() => {
                  setEditAnimal(null);
                  setAnimalOpen(true);
                }}
              >
                <PawPrint className="h-3.5 w-3.5" /> Animal
              </Button>
            )}
            {isDairy && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1"
                onClick={() => setMilkOpen(true)}
              >
                <Droplets className="h-3.5 w-3.5" /> Milk
              </Button>
            )}
            {showEggs && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1"
                onClick={() => setEggOpen(true)}
              >
                <Egg className="h-3.5 w-3.5" /> Eggs
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="gap-1"
              onClick={() => setHealthOpen(true)}
            >
              <Activity className="h-3.5 w-3.5" /> Health
            </Button>
            {isContract && batch.active && batch.contract && batch.currentCount > 0 && (
              <Button
                size="sm"
                className="gap-1"
                onClick={() => setLiftOpen(true)}
              >
                <Truck className="h-3.5 w-3.5" /> Record lift
              </Button>
            )}
            {batch.active && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1"
                onClick={() => setCloseOpen(true)}
              >
                <CheckCircle2 className="h-3.5 w-3.5" /> Close
              </Button>
            )}
            {!batch.active && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1"
                onClick={async () => {
                  if (
                    !confirm(
                      "Reopen this batch? It'll accept new entries again.",
                    )
                  )
                    return;
                  const res = await fetch(
                    `/api/livestock-batches/${batchId}`,
                    {
                      method: "PATCH",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ active: true }),
                    },
                  );
                  if (res.ok) refresh();
                }}
              >
                <RotateCcw className="h-3.5 w-3.5" /> Reopen
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="gap-1"
              onClick={() => setEditOpen(true)}
            >
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Button>
          </div>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
        <KpiCard
          icon={<Users className="h-3.5 w-3.5" />}
          label="Head count"
          value={`${batch.currentCount}`}
          hint={`of ${batch.initialCount} initial`}
        />
        <KpiCard
          icon={<Skull className="h-3.5 w-3.5" />}
          label="Mortality"
          value={
            batch.initialCount > 0 ? `${mortalityPct.toFixed(1)}%` : "—"
          }
          hint={
            totalDeaths > 0
              ? `${totalDeaths} death${totalDeaths === 1 ? "" : "s"}`
              : "No deaths recorded"
          }
          tone={mortalityPct > 5 ? "negative" : "default"}
        />
        <KpiCard
          icon={<CalendarClock className="h-3.5 w-3.5" />}
          label="Days in cycle"
          value={`${daysInCycle}`}
          hint={
            batch.expectedCycleDays
              ? `of ${batch.expectedCycleDays} expected`
              : "Open-ended"
          }
          progress={cycleProgress ?? undefined}
        />
        <KpiCard
          icon={<Gauge className="h-3.5 w-3.5" />}
          label="FCR"
          value={analytics?.fcr != null ? analytics.fcr.toFixed(2) : "—"}
          hint={
            analytics?.adgGrams != null
              ? `ADG ${analytics.adgGrams.toFixed(0)} g/day`
              : analytics?.warnings.missingArrivalWeight
                ? "Set arrival weight to enable"
                : "Awaiting weighing"
          }
          tone={
            analytics?.fcr != null &&
            batch.targetFCR != null &&
            analytics.fcr > batch.targetFCR
              ? "negative"
              : "default"
          }
        />
        <KpiCard
          icon={<Wallet className="h-3.5 w-3.5" />}
          label={
            isContract && analytics?.contractPayout
              ? "Expected payout"
              : summary.net >= 0
                ? "Net P&L"
                : "Net loss"
          }
          value={
            isContract && analytics?.contractPayout
              ? formatINR(analytics.contractPayout.expectedPayout)
              : formatINR(Math.abs(summary.net))
          }
          tone={
            !isContract && summary.net < 0 ? "negative" : "default"
          }
          hint={
            isContract && analytics?.contractPayout
              ? `${analytics.contractPayout.liftedWeightKg.toFixed(0)} kg @ ₹${batch.contract?.agreedRatePerKg ?? 0}`
              : `${formatINR(summary.income)} in · ${formatINR(summary.expense)} out`
          }
        />
      </section>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          {showWeighingsTab && (
            <TabsTrigger value="weighings">
              Weighings ({weighings.length})
            </TabsTrigger>
          )}
          <TabsTrigger value="feed">Feed ({feedLogs.length})</TabsTrigger>
          <TabsTrigger value="mortality">
            Mortality ({mortality.length})
          </TabsTrigger>
          <TabsTrigger value="health">
            Health (
            {vaccinations.length + healthLogs.length}
            {openHealthCount > 0 ? ` · ${openHealthCount} open` : ""}
            )
          </TabsTrigger>
          <TabsTrigger value="events">
            Movements ({events.length})
          </TabsTrigger>
          {showAnimalsTab && (
            <TabsTrigger value="animals">
              Animals ({animals.length})
            </TabsTrigger>
          )}
          {isContract && (
            <TabsTrigger value="contract">Contract payout</TabsTrigger>
          )}
          {isDairy && (
            <TabsTrigger value="milk">
              Milk ({milkLogs.length})
            </TabsTrigger>
          )}
          {showEggs && (
            <TabsTrigger value="eggs">
              Eggs ({eggLogs.length})
            </TabsTrigger>
          )}
          <TabsTrigger value="documents">Documents</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-xl border bg-card p-4 lg:col-span-2">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Weight gain over time</h2>
                <span className="text-[10px] text-muted-foreground">
                  Avg per bird/animal (kg)
                </span>
              </div>
              {weighingSeries.length === 0 ? (
                <EmptyChart msg="No weighings logged yet — record an arrival weighing to seed the chart." />
              ) : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={weighingSeries}
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
                        unit=" kg"
                      />
                      <Tooltip
                        formatter={(v) => `${Number(v).toFixed(3)} kg`}
                        contentStyle={{ fontSize: 11, borderRadius: 6 }}
                      />
                      {batch.targetWeight != null && (
                        <ReferenceLine
                          y={batch.targetWeight}
                          stroke="#10b981"
                          strokeDasharray="4 4"
                          label={{
                            value: `Target ${batch.targetWeight} kg`,
                            position: "right",
                            fontSize: 9,
                            fill: "#059669",
                          }}
                        />
                      )}
                      <Line
                        type="monotone"
                        dataKey="avgKg"
                        stroke="#6366f1"
                        strokeWidth={2}
                        dot={{ r: 3 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="rounded-xl border bg-card p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Head count</h2>
                <span className="text-[10px] text-muted-foreground">
                  Purchases − deaths − sales
                </span>
              </div>
              {eventCountSeries.length === 0 ? (
                <EmptyChart msg="No movement yet." />
              ) : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={eventCountSeries}
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
                      />
                      <Tooltip
                        contentStyle={{ fontSize: 11, borderRadius: 6 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="count"
                        stroke="#10b981"
                        strokeWidth={2}
                        dot={{ r: 3 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-xl border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Feed spend</h2>
              <span className="text-[10px] text-muted-foreground">
                Daily aggregate · ₹
              </span>
            </div>
            {feedSeries.length === 0 ? (
              <EmptyChart msg="No feed logs yet." />
            ) : (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={feedSeries}
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
                        v >= 1000 ? `₹${Math.round(v / 1000)}k` : `₹${v}`
                      }
                    />
                    <Tooltip
                      formatter={(v) => formatINR(Number(v))}
                      contentStyle={{ fontSize: 11, borderRadius: 6 }}
                    />
                    <Bar
                      dataKey="amount"
                      fill="#f59e0b"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MiniStat
              label="Feed spend"
              value={formatINR(analytics?.totalFeedSpend ?? 0)}
              hint={
                (analytics?.totalFeedKg ?? 0) > 0
                  ? `${(analytics?.totalFeedKg ?? 0).toFixed(1)} kg logged`
                  : analytics?.warnings.missingFeedQuantity
                    ? "Quantity missing on some logs — FCR may be low"
                    : undefined
              }
            />
            <MiniStat
              label="Labour spend"
              value={formatINR(summary.labor)}
              hint={
                summary.labor > 0
                  ? `${((summary.labor / Math.max(1, summary.expense)) * 100).toFixed(0)}% of total expense`
                  : "From WAGE-kind transactions tagged to this batch"
              }
            />
            <MiniStat
              label="Live-weight gain"
              value={
                analytics?.liveWeightGainKg
                  ? `${analytics.liveWeightGainKg.toFixed(1)} kg`
                  : "—"
              }
              hint={
                analytics?.latestAvgKg != null
                  ? `Latest avg ${analytics.latestAvgKg.toFixed(3)} kg / bird`
                  : "Awaiting weighings"
              }
            />
            <MiniStat
              label="Vaccination spend"
              value={formatINR(
                vaccinations.reduce((s, v) => s + (v.cost ?? 0), 0),
              )}
              hint={
                vaccinations.length > 0
                  ? `${vaccinations.length} dose${vaccinations.length === 1 ? "" : "s"}`
                  : undefined
              }
            />
          </div>
        </TabsContent>

        {showWeighingsTab && (
          <TabsContent value="weighings">
            {weighings.length === 0 ? (
              <Empty msg="No weighings yet. Use the Weighing button up top to log arrival or interim weights — drives FCR + ADG." />
            ) : (
              <div className="overflow-hidden rounded-xl border bg-card">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Date</th>
                      <th className="px-3 py-2 text-left font-medium">Phase</th>
                      <th className="px-3 py-2 text-right font-medium">
                        Sample
                      </th>
                      <th className="px-3 py-2 text-right font-medium">
                        Total kg
                      </th>
                      <th className="px-3 py-2 text-right font-medium">
                        Avg kg
                      </th>
                      <th className="px-3 py-2 text-left font-medium">
                        Notes
                      </th>
                      <th className="px-3 py-2 text-right" />
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {weighings.map((w) => (
                      <tr key={w.id} className="hover:bg-muted/40">
                        <td className="px-3 py-2 text-xs tabular-nums text-muted-foreground">
                          {formatDate(w.date)}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          <Badge variant="outline" className="text-[10px]">
                            {w.phase.toLowerCase()}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-right text-xs tabular-nums">
                          {w.sampleSize}
                        </td>
                        <td className="px-3 py-2 text-right text-xs tabular-nums">
                          {w.totalKg.toFixed(3)}
                        </td>
                        <td className="px-3 py-2 text-right text-xs font-medium tabular-nums">
                          {w.avgKg.toFixed(3)}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground line-clamp-1">
                          {w.notes ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setEditWeighing(w);
                                setWeighingOpen(true);
                              }}
                              className="text-[10px] hover:underline"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteWeighing(w.id)}
                              className="text-[10px] text-destructive hover:underline"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>
        )}

        <TabsContent value="feed">
          {feedLogs.length === 0 ? (
            <Empty msg="No feed logs yet. Log feed from the batch list to start tracking consumption + FCR." />
          ) : (
            <div className="overflow-hidden rounded-xl border bg-card">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Date</th>
                    <th className="px-3 py-2 text-right font-medium">
                      Quantity
                    </th>
                    <th className="px-3 py-2 text-right font-medium">Cost</th>
                    <th className="px-3 py-2 text-left font-medium">Notes</th>
                    <th className="px-3 py-2 text-right" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {feedLogs.map((f) => (
                    <tr key={f.id} className="hover:bg-muted/40">
                      <td className="px-3 py-2 text-xs tabular-nums text-muted-foreground">
                        {formatDate(f.date)}
                      </td>
                      <td className="px-3 py-2 text-right text-xs tabular-nums">
                        {f.quantity != null
                          ? `${f.quantity}${f.unit ? ` ${f.unit}` : ""}`
                          : "—"}
                      </td>
                      <td className="px-3 py-2 text-right text-xs font-medium tabular-nums">
                        {formatINR(f.amount)}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground line-clamp-1">
                        {f.notes ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setEditFeed(f)}
                            className="text-[10px] hover:underline"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteFeed(f.id)}
                            className="text-[10px] text-destructive hover:underline"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="mortality">
          {mortality.length === 0 ? (
            <Empty msg="No mortality recorded. Use the Mortality button up top — deaths auto-decrement the head count and culls are tracked separately." />
          ) : (
            <div className="overflow-hidden rounded-xl border bg-card">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Date</th>
                    <th className="px-3 py-2 text-right font-medium">Count</th>
                    <th className="px-3 py-2 text-left font-medium">Cause</th>
                    <th className="px-3 py-2 text-left font-medium">Kind</th>
                    <th className="px-3 py-2 text-left font-medium">Notes</th>
                    <th className="px-3 py-2 text-right" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {mortality.map((m) => (
                    <tr key={m.id} className="hover:bg-muted/40">
                      <td className="px-3 py-2 text-xs tabular-nums text-muted-foreground">
                        {formatDate(m.date)}
                      </td>
                      <td className="px-3 py-2 text-right text-xs font-medium tabular-nums">
                        {m.count}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {CAUSE_LABEL[m.cause] ?? m.cause}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {m.culled ? (
                          <Badge
                            variant="outline"
                            className="text-[10px] text-amber-700 dark:text-amber-300"
                          >
                            culled
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">death</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground line-clamp-1">
                        {m.notes ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setEditMortality(m);
                              setMortalityOpen(true);
                            }}
                            className="text-[10px] hover:underline"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteMortality(m.id)}
                            className="text-[10px] text-destructive hover:underline"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="health" className="space-y-4">
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Disease / treatment ({healthLogs.length})
              </h3>
            </div>
            {healthLogs.length === 0 ? (
              <Empty msg="No disease incidents recorded. Use the Health button up top to log symptoms + treatment." />
            ) : (
              <div className="overflow-hidden rounded-xl border bg-card">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Date</th>
                      <th className="px-3 py-2 text-left font-medium">
                        Condition
                      </th>
                      <th className="px-3 py-2 text-left font-medium">
                        Treatment
                      </th>
                      <th className="px-3 py-2 text-right font-medium">Cost</th>
                      <th className="px-3 py-2 text-left font-medium">
                        Status
                      </th>
                      <th className="px-3 py-2 text-right" />
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {healthLogs.map((h) => (
                      <tr key={h.id} className="hover:bg-muted/40">
                        <td className="px-3 py-2 text-xs tabular-nums text-muted-foreground">
                          {formatDate(h.date)}
                        </td>
                        <td className="px-3 py-2 text-xs font-medium">
                          {h.condition}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground line-clamp-1">
                          {h.treatment ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-right text-xs tabular-nums">
                          {h.cost != null ? formatINR(h.cost) : "—"}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {h.resolved ? (
                            <Badge className="bg-emerald-100 text-emerald-800 text-[10px] dark:bg-emerald-950 dark:text-emerald-300">
                              Resolved
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="text-[10px] text-amber-700 dark:text-amber-300"
                            >
                              Open
                            </Badge>
                          )}
                          {h.resolvedAt && (
                            <div className="mt-0.5 text-[10px] text-muted-foreground">
                              {formatDate(h.resolvedAt)}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setEditHealth(h)}
                              className="text-[10px] hover:underline"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleHealthResolved(h.id, !h.resolved)}
                              className="text-[10px] hover:underline"
                            >
                              {h.resolved ? "Reopen" : "Resolve"}
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteHealth(h.id)}
                              className="text-[10px] text-destructive hover:underline"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Vaccinations ({vaccinations.length})
              </h3>
            </div>
            {vaccinations.length === 0 ? (
              <Empty msg="No vaccinations recorded yet." />
            ) : (
              <div className="overflow-hidden rounded-xl border bg-card">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Date</th>
                      <th className="px-3 py-2 text-left font-medium">
                        <span className="inline-flex items-center gap-1">
                          <Stethoscope className="h-3 w-3" /> Vaccine
                        </span>
                      </th>
                      <th className="px-3 py-2 text-left font-medium">
                        Next due
                      </th>
                      <th className="px-3 py-2 text-right font-medium">Cost</th>
                      <th className="px-3 py-2 text-right" />
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {vaccinations.map((v) => (
                      <tr key={v.id} className="hover:bg-muted/40">
                        <td className="px-3 py-2 text-xs tabular-nums text-muted-foreground">
                          {formatDate(v.date)}
                        </td>
                        <td className="px-3 py-2 text-xs font-medium">
                          <span className="inline-flex items-center gap-1">
                            <HeartPulse className="h-3 w-3 text-rose-500" />
                            {v.vaccine}
                          </span>
                          {v.notes && (
                            <div className="mt-0.5 text-[10px] font-normal text-muted-foreground line-clamp-1">
                              {v.notes}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {v.nextDueDate ? formatDate(v.nextDueDate) : "—"}
                        </td>
                        <td className="px-3 py-2 text-right text-xs tabular-nums">
                          {v.cost != null ? formatINR(v.cost) : "—"}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setEditVaccination(v)}
                              className="text-[10px] hover:underline"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteVaccination(v.id)}
                              className="text-[10px] text-destructive hover:underline"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="events" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-md border bg-card p-0.5 text-[11px]">
              {(["ALL", "PURCHASE", "BIRTH", "DEATH", "SALE"] as const).map(
                (k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setEventFilter(k)}
                    className={`rounded px-2.5 py-1 capitalize transition-colors ${
                      eventFilter === k
                        ? "bg-muted font-medium text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {k.toLowerCase()}
                  </button>
                ),
              )}
            </div>
          </div>

          {filteredEvents.length === 0 ? (
            <Empty
              msg={
                events.length === 0
                  ? "No movements yet."
                  : "No events match this filter."
              }
            />
          ) : (
            <div className="overflow-hidden rounded-xl border bg-card">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Date</th>
                    <th className="px-3 py-2 text-left font-medium">Type</th>
                    <th className="px-3 py-2 text-right font-medium">Count</th>
                    <th className="px-3 py-2 text-right font-medium">
                      Avg kg
                    </th>
                    <th className="px-3 py-2 text-right font-medium">
                      Unit ₹
                    </th>
                    <th className="px-3 py-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredEvents.map((e) => {
                    const total =
                      e.unitValue != null ? e.unitValue * e.count : null;
                    return (
                      <tr key={e.id} className="hover:bg-muted/40">
                        <td className="px-3 py-2 text-xs tabular-nums text-muted-foreground">
                          {formatDate(e.date)}
                        </td>
                        <td className="px-3 py-2">
                          <EventBadge type={e.eventType} />
                          {e.notes && (
                            <div className="mt-0.5 text-[10px] text-muted-foreground line-clamp-1">
                              {e.notes}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right text-xs tabular-nums">
                          {e.count}
                        </td>
                        <td className="px-3 py-2 text-right text-xs tabular-nums text-muted-foreground">
                          {e.avgWeightKg != null
                            ? e.avgWeightKg.toFixed(3)
                            : "—"}
                        </td>
                        <td className="px-3 py-2 text-right text-xs tabular-nums text-muted-foreground">
                          {e.unitValue != null ? formatINR(e.unitValue) : "—"}
                        </td>
                        <td className="px-3 py-2 text-right text-xs font-medium tabular-nums">
                          {total != null ? formatINR(total) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {showAnimalsTab && (
          <TabsContent value="animals" className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[11px] text-muted-foreground">
                Optional per-animal tracking. Inactive animals stay for
                history but won&rsquo;t count toward the live head.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="gap-1"
                onClick={() => {
                  setEditAnimal(null);
                  setAnimalOpen(true);
                }}
              >
                <Plus className="h-3.5 w-3.5" /> Animal
              </Button>
            </div>
            {animals.length === 0 ? (
              <Empty msg="No individual animals tracked yet — bulk-only batches can skip this." />
            ) : (
              <div className="overflow-hidden rounded-xl border bg-card">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Tag</th>
                      <th className="px-3 py-2 text-left font-medium">Name</th>
                      <th className="px-3 py-2 text-left font-medium">Sex</th>
                      <th className="px-3 py-2 text-left font-medium">DOB</th>
                      <th className="px-3 py-2 text-left font-medium">Breed</th>
                      <th className="px-3 py-2 text-left font-medium">
                        Status
                      </th>
                      <th className="px-3 py-2 text-right" />
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {animals.map((a) => (
                      <tr key={a.id} className="hover:bg-muted/40">
                        <td className="px-3 py-2 text-xs font-medium">
                          <Link
                            href={`/livestock-animals/${a.id}`}
                            className="hover:underline"
                          >
                            #{a.tagNumber}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-xs">{a.name ?? "—"}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {a.sex.toLowerCase()}
                        </td>
                        <td className="px-3 py-2 text-xs tabular-nums text-muted-foreground">
                          {a.dob ? formatDate(a.dob) : "—"}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {a.breed ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {a.active ? (
                            <Badge className="bg-emerald-100 text-emerald-800 text-[10px] dark:bg-emerald-950 dark:text-emerald-300">
                              Active
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-[10px]">
                              Inactive
                            </Badge>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setEditAnimal(a);
                                setAnimalOpen(true);
                              }}
                              className="text-[10px] hover:underline"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteAnimal(a.id)}
                              className="text-[10px] text-destructive hover:underline"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>
        )}

        {isContract && (
          <TabsContent value="contract">
            <ContractPayoutPanel
              batch={batch}
              analytics={analytics}
              mortalityPct={mortalityPct}
            />
          </TabsContent>
        )}

        {isDairy && (
          <TabsContent value="milk" className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <MiniStat
                label="30-day production"
                value={`${milk30dLitres.toFixed(1)} L`}
                hint={
                  milkSeries.length > 0
                    ? `Avg ${(milk30dLitres / Math.max(1, Math.min(30, milkSeries.length))).toFixed(1)} L/day`
                    : undefined
                }
              />
              <MiniStat
                label="30-day revenue"
                value={formatINR(milk30dRevenue)}
                hint={
                  milk30dRevenue > 0 && milk30dLitres > 0
                    ? `₹${(milk30dRevenue / milk30dLitres).toFixed(2)} blended rate`
                    : undefined
                }
              />
              <MiniStat
                label="Logs"
                value={`${milkLogs.length}`}
                hint={
                  milkLogs.some((m) => m.fatPct != null)
                    ? "Quality recorded on some logs"
                    : undefined
                }
              />
            </div>
            <div className="rounded-xl border bg-card p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Daily milk output</h2>
                <span className="text-[10px] text-muted-foreground">
                  Total litres per day · 30-day window
                </span>
              </div>
              {milkSeries.length === 0 ? (
                <EmptyChart msg="No milk logged yet — use the Milk button up top to record today's session." />
              ) : (
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={milkSeries}
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
                        unit=" L"
                      />
                      <Tooltip
                        formatter={(v) => `${Number(v).toFixed(2)} L`}
                        contentStyle={{ fontSize: 11, borderRadius: 6 }}
                      />
                      <Bar
                        dataKey="litres"
                        fill="#06b6d4"
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
            {milkLogs.length === 0 ? null : (
              <div className="overflow-hidden rounded-xl border bg-card">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Date</th>
                      <th className="px-3 py-2 text-right font-medium">
                        Total L
                      </th>
                      <th className="px-3 py-2 text-right font-medium">
                        Sold L
                      </th>
                      <th className="px-3 py-2 text-right font-medium">
                        Rate
                      </th>
                      <th className="px-3 py-2 text-right font-medium">
                        Revenue
                      </th>
                      <th className="px-3 py-2 text-left font-medium">
                        Quality
                      </th>
                      <th className="px-3 py-2 text-right" />
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {milkLogs.map((m) => {
                      const revenue =
                        m.soldLitres != null && m.ratePerLitre != null
                          ? m.soldLitres * m.ratePerLitre
                          : null;
                      return (
                        <tr key={m.id} className="hover:bg-muted/40">
                          <td className="px-3 py-2 text-xs tabular-nums text-muted-foreground">
                            {formatDate(m.date)}
                          </td>
                          <td className="px-3 py-2 text-right text-xs font-medium tabular-nums">
                            {m.totalLitres.toFixed(2)}
                          </td>
                          <td className="px-3 py-2 text-right text-xs tabular-nums text-muted-foreground">
                            {m.soldLitres != null
                              ? m.soldLitres.toFixed(2)
                              : "—"}
                          </td>
                          <td className="px-3 py-2 text-right text-xs tabular-nums text-muted-foreground">
                            {m.ratePerLitre != null
                              ? formatINR(m.ratePerLitre)
                              : "—"}
                          </td>
                          <td className="px-3 py-2 text-right text-xs font-medium tabular-nums">
                            {revenue != null ? formatINR(revenue) : "—"}
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">
                            {[
                              m.fatPct != null
                                ? `Fat ${m.fatPct.toFixed(1)}%`
                                : null,
                              m.snfPct != null
                                ? `SNF ${m.snfPct.toFixed(1)}%`
                                : null,
                            ]
                              .filter(Boolean)
                              .join(" · ") || "—"}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => setEditMilk(m)}
                                className="text-[10px] hover:underline"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => deleteMilk(m.id)}
                                className="text-[10px] text-destructive hover:underline"
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>
        )}

        {showEggs && (
          <TabsContent value="eggs" className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <MiniStat
                label="30-day collected"
                value={`${egg30dCollected}`}
                hint={
                  eggSeries.length > 0
                    ? `Avg ${(egg30dCollected / Math.max(1, eggSeries.length)).toFixed(0)}/day`
                    : undefined
                }
              />
              <MiniStat
                label="30-day sold"
                value={`${egg30dSold}`}
                hint={
                  egg30dCollected > 0
                    ? `${Math.round((egg30dSold / egg30dCollected) * 100)}% sell-through`
                    : undefined
                }
              />
              <MiniStat
                label="30-day revenue"
                value={formatINR(egg30dRevenue)}
                hint={
                  egg30dSold > 0
                    ? `₹${(egg30dRevenue / egg30dSold).toFixed(2)} blended`
                    : undefined
                }
              />
              <MiniStat
                label="HD %"
                value={hdPercent != null ? `${hdPercent.toFixed(1)}%` : "—"}
                hint="Hen-day production — daily eggs ÷ live birds"
              />
            </div>
            <div className="rounded-xl border bg-card p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Daily collection</h2>
                <span className="text-[10px] text-muted-foreground">
                  30-day window
                </span>
              </div>
              {eggSeries.length === 0 ? (
                <EmptyChart msg="No eggs logged yet — use the Eggs button up top to record today's collection." />
              ) : (
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={eggSeries}
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
                      />
                      <Tooltip
                        formatter={(v) => `${v} eggs`}
                        contentStyle={{ fontSize: 11, borderRadius: 6 }}
                      />
                      <Bar
                        dataKey="collected"
                        fill="#f59e0b"
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
            {eggLogs.length > 0 && (
              <div className="overflow-hidden rounded-xl border bg-card">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Date</th>
                      <th className="px-3 py-2 text-right font-medium">
                        Collected
                      </th>
                      <th className="px-3 py-2 text-right font-medium">
                        Broken
                      </th>
                      <th className="px-3 py-2 text-right font-medium">Sold</th>
                      <th className="px-3 py-2 text-right font-medium">
                        Price
                      </th>
                      <th className="px-3 py-2 text-right font-medium">
                        Revenue
                      </th>
                      <th className="px-3 py-2 text-right" />
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {eggLogs.map((e) => {
                      const revenue =
                        e.sold != null && e.salePricePerEgg != null
                          ? e.sold * e.salePricePerEgg
                          : null;
                      return (
                        <tr key={e.id} className="hover:bg-muted/40">
                          <td className="px-3 py-2 text-xs tabular-nums text-muted-foreground">
                            {formatDate(e.date)}
                          </td>
                          <td className="px-3 py-2 text-right text-xs font-medium tabular-nums">
                            {e.collected}
                          </td>
                          <td className="px-3 py-2 text-right text-xs tabular-nums text-muted-foreground">
                            {e.broken ?? "—"}
                          </td>
                          <td className="px-3 py-2 text-right text-xs tabular-nums text-muted-foreground">
                            {e.sold ?? "—"}
                          </td>
                          <td className="px-3 py-2 text-right text-xs tabular-nums text-muted-foreground">
                            {e.salePricePerEgg != null
                              ? formatINR(e.salePricePerEgg)
                              : "—"}
                          </td>
                          <td className="px-3 py-2 text-right text-xs font-medium tabular-nums">
                            {revenue != null ? formatINR(revenue) : "—"}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => setEditEgg(e)}
                                className="text-[10px] hover:underline"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => deleteEgg(e.id)}
                                className="text-[10px] text-destructive hover:underline"
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>
        )}

        <TabsContent value="documents">
          <AttachmentList
            ownerKind="LIVESTOCK_BATCH_DOCUMENT"
            ownerId={batchId}
            emptyMessage="No documents yet. Upload vet reports, contract papers, or batch photos."
            accept="image/*,application/pdf"
          />
        </TabsContent>
      </Tabs>

      <LogWeighingDialog
        key={`weighing-${editWeighing?.id ?? "new"}-${weighingOpen}`}
        open={weighingOpen}
        onOpenChange={(o) => {
          setWeighingOpen(o);
          if (!o) setEditWeighing(null);
        }}
        batchId={batchId}
        animals={showAnimalsTab ? animals.filter((a) => a.active) : undefined}
        initial={editWeighing ?? undefined}
        onSaved={refresh}
      />
      <LogMortalityDialog
        key={`mortality-${editMortality?.id ?? "new"}-${mortalityOpen}`}
        open={mortalityOpen}
        onOpenChange={(o) => {
          setMortalityOpen(o);
          if (!o) setEditMortality(null);
        }}
        batchId={batchId}
        animals={showAnimalsTab ? animals.filter((a) => a.active) : undefined}
        initial={editMortality ?? undefined}
        onSaved={refresh}
      />
      <LogMilkDialog
        key={`milk-${milkOpen}`}
        open={milkOpen}
        onOpenChange={setMilkOpen}
        batchId={batchId}
        animals={showAnimalsTab ? animals.filter((a) => a.active) : undefined}
        onSaved={refresh}
      />
      <LogEggDialog
        key={`egg-${eggOpen}`}
        open={eggOpen}
        onOpenChange={setEggOpen}
        batchId={batchId}
        onSaved={refresh}
      />
      <LogHealthDialog
        key={`health-${healthOpen}`}
        open={healthOpen}
        onOpenChange={setHealthOpen}
        batchId={batchId}
        animals={showAnimalsTab ? animals.filter((a) => a.active) : undefined}
        onSaved={refresh}
      />
      {isContract && batch.contract && (
        <RecordLiftDialog
          key={`lift-${liftOpen}`}
          open={liftOpen}
          onOpenChange={setLiftOpen}
          batchId={batchId}
          liveHead={batch.currentCount}
          latestAvgKg={analytics?.latestAvgKg ?? null}
          agreedRatePerKg={batch.contract.agreedRatePerKg}
          integratorName={batch.contract.integratorName}
          onSaved={refresh}
        />
      )}
      <CloseBatchDialog
        key={`close-${closeOpen}`}
        open={closeOpen}
        onOpenChange={setCloseOpen}
        batchId={batchId}
        batchName={batch.name}
        isContract={isContract}
        netPnL={summary.net}
        onClosed={refresh}
      />
      {editVaccination && (
        <EditVaccinationDialog
          key={`edit-vacc-${editVaccination.id}`}
          open={!!editVaccination}
          onOpenChange={(o) => !o && setEditVaccination(null)}
          batchId={batchId}
          initial={editVaccination}
          onSaved={refresh}
        />
      )}
      {editFeed && (
        <EditFeedDialog
          key={`edit-feed-${editFeed.id}`}
          open={!!editFeed}
          onOpenChange={(o) => !o && setEditFeed(null)}
          batchId={batchId}
          initial={editFeed}
          onSaved={refresh}
        />
      )}
      {editMilk && (
        <LogMilkDialog
          key={`edit-milk-${editMilk.id}`}
          open={!!editMilk}
          onOpenChange={(o) => !o && setEditMilk(null)}
          batchId={batchId}
          animals={showAnimalsTab ? animals.filter((a) => a.active) : undefined}
          initial={editMilk}
          onSaved={refresh}
        />
      )}
      {editEgg && (
        <LogEggDialog
          key={`edit-egg-${editEgg.id}`}
          open={!!editEgg}
          onOpenChange={(o) => !o && setEditEgg(null)}
          batchId={batchId}
          initial={editEgg}
          onSaved={refresh}
        />
      )}
      {editHealth && (
        <LogHealthDialog
          key={`edit-health-${editHealth.id}`}
          open={!!editHealth}
          onOpenChange={(o) => !o && setEditHealth(null)}
          batchId={batchId}
          animals={showAnimalsTab ? animals.filter((a) => a.active) : undefined}
          initial={editHealth}
          onSaved={refresh}
        />
      )}
      <EditBatchDialog
        key={`edit-${editOpen}`}
        open={editOpen}
        onOpenChange={setEditOpen}
        batch={{
          id: batch.id,
          name: batch.name,
          productionType: batch.productionType,
          contractId: batch.contractId,
          landId: batch.landId,
          startDate: batch.startDate,
          endDate: batch.endDate,
          expectedCycleDays: batch.expectedCycleDays,
          initialAvgWeight: batch.initialAvgWeight,
          targetWeight: batch.targetWeight,
          targetFCR: batch.targetFCR,
          notes: batch.notes,
          active: batch.active,
        }}
        onSaved={refresh}
      />
      <AnimalFormDialog
        key={`animal-${editAnimal?.id ?? "new"}-${animalOpen}`}
        open={animalOpen}
        onOpenChange={setAnimalOpen}
        batchId={batchId}
        initial={
          editAnimal
            ? {
                id: editAnimal.id,
                tagNumber: editAnimal.tagNumber,
                name: editAnimal.name ?? "",
                sex: editAnimal.sex,
                dob: editAnimal.dob ?? "",
                breed: editAnimal.breed ?? "",
                color: editAnimal.color ?? "",
                notes: editAnimal.notes ?? "",
              }
            : undefined
        }
        onSaved={refresh}
      />
    </div>
  );
}

function ContractPayoutPanel({
  batch,
  analytics,
  mortalityPct,
}: {
  batch: BatchDetail["batch"];
  analytics: Analytics | undefined;
  mortalityPct: number;
}) {
  if (!batch.contract) {
    return (
      <Empty msg="No contract linked. Set productionType to BROILER_CONTRACT and pick a contract from the Edit batch form." />
    );
  }
  if (!analytics?.contractPayout) {
    return (
      <Empty msg="Add an exit (or interim) weighing to compute the expected payout." />
    );
  }
  const p = analytics.contractPayout;
  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">
            {batch.contract.integratorName}
            {batch.contract.contractRef && (
              <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">
                · {batch.contract.contractRef}
              </span>
            )}
          </h2>
          <span className="text-[11px] text-muted-foreground">
            Base ₹{batch.contract.agreedRatePerKg.toFixed(2)} / kg
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <PayoutLine
            label="Lifted weight"
            value={`${p.liftedWeightKg.toFixed(1)} kg`}
          />
          <PayoutLine
            label="Base payout"
            value={formatINR(p.basePayout)}
            tone="positive"
          />
          <PayoutLine
            label={`FCR bonus${p.fcrBonusPerKg ? ` (₹${p.fcrBonusPerKg.toFixed(2)}/kg)` : ""}`}
            value={formatINR(p.fcrBonusAmount)}
            tone={p.fcrBonusAmount > 0 ? "positive" : "muted"}
          />
          <PayoutLine
            label={`Mortality penalty${p.mortalityPenaltyPerKg ? ` (₹${p.mortalityPenaltyPerKg.toFixed(2)}/kg)` : ""}`}
            value={
              p.mortalityPenaltyAmount > 0
                ? `−${formatINR(p.mortalityPenaltyAmount)}`
                : formatINR(0)
            }
            tone={p.mortalityPenaltyAmount > 0 ? "negative" : "muted"}
          />
        </div>
        <div className="mt-4 flex items-center justify-between border-t pt-3">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Expected payout
          </span>
          <span className="text-2xl font-semibold tabular-nums">
            {formatINR(p.expectedPayout)}
          </span>
        </div>
      </div>
      <div className="rounded-xl border bg-muted/30 p-3 text-[11px] text-muted-foreground">
        <strong className="text-foreground">How this updates:</strong> The
        moment you log a new weighing or mortality row, FCR + mortality % are
        re-computed and the bonus / penalty bands re-evaluated. Current
        mortality stands at {mortalityPct.toFixed(2)}%.
      </div>
    </div>
  );
}

function PayoutLine({
  label,
  value,
  tone = "muted",
}: {
  label: string;
  value: string;
  tone?: "positive" | "negative" | "muted";
}) {
  return (
    <div className="rounded-md border bg-muted/40 p-2.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={`mt-0.5 text-sm font-medium tabular-nums ${
          tone === "positive"
            ? "text-emerald-700 dark:text-emerald-400"
            : tone === "negative"
              ? "text-destructive"
              : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function buildFeedSeries(
  feedLogs: BatchDetail["feedLogs"],
): { date: string; label: string; amount: number }[] {
  if (!feedLogs.length) return [];
  const byDate = new Map<string, number>();
  for (const f of feedLogs) {
    const day = f.date.slice(0, 10);
    byDate.set(day, (byDate.get(day) ?? 0) + f.amount);
  }
  return [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, amount]) => ({
      date,
      amount,
      label: new Date(date).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
      }),
    }));
}

function buildEventCountSeries(
  events: BatchDetail["events"],
): { date: string; label: string; count: number }[] {
  if (!events.length) return [];
  const ordered = [...events].sort((a, b) => a.date.localeCompare(b.date));
  let running = 0;
  return ordered.map((e) => {
    if (e.eventType === "PURCHASE" || e.eventType === "BIRTH") {
      running += e.count;
    } else {
      running -= e.count;
    }
    return {
      date: e.date,
      label: new Date(e.date).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
      }),
      count: Math.max(0, running),
    };
  });
}

function buildEggSeries(
  eggLogs: BatchDetail["eggLogs"],
  nowMs: number,
): { date: string; label: string; collected: number }[] {
  if (!eggLogs.length) return [];
  const cutoff = nowMs - 30 * 86400000;
  const byDate = new Map<string, number>();
  for (const e of eggLogs) {
    if (new Date(e.date).getTime() < cutoff) continue;
    const day = e.date.slice(0, 10);
    byDate.set(day, (byDate.get(day) ?? 0) + e.collected);
  }
  return [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, collected]) => ({
      date,
      collected,
      label: new Date(date).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
      }),
    }));
}

function buildMilkSeries(
  milkLogs: BatchDetail["milkLogs"],
  nowMs: number,
): { date: string; label: string; litres: number }[] {
  if (!milkLogs.length) return [];
  // 30-day rolling window so the chart stays readable on long-cycle
  // dairy batches. `nowMs` is the mounted-once timestamp from the page
  // so we satisfy React's purity rule.
  const cutoff = nowMs - 30 * 86400000;
  const byDate = new Map<string, number>();
  for (const m of milkLogs) {
    if (new Date(m.date).getTime() < cutoff) continue;
    const day = m.date.slice(0, 10);
    byDate.set(day, (byDate.get(day) ?? 0) + m.totalLitres);
  }
  return [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, litres]) => ({
      date,
      litres,
      label: new Date(date).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
      }),
    }));
}

function buildWeighingSeries(
  weighings: BatchDetail["weighings"],
): { date: string; label: string; avgKg: number; phase: string }[] {
  if (!weighings.length) return [];
  return [...weighings]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((w) => ({
      date: w.date,
      avgKg: w.avgKg,
      phase: w.phase,
      label: new Date(w.date).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
      }),
    }));
}

function EventBadge({
  type,
}: {
  type: BatchDetail["events"][number]["eventType"];
}) {
  const palette: Record<typeof type, string> = {
    PURCHASE: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
    BIRTH:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
    DEATH: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
    SALE: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${palette[type]}`}
    >
      {type.toLowerCase()}
    </span>
  );
}

function KpiCard({
  icon,
  label,
  value,
  hint,
  tone = "default",
  progress,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "negative";
  progress?: number;
}) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div
        className={`mt-1 text-base font-semibold tabular-nums ${
          tone === "negative" ? "text-destructive" : ""
        }`}
      >
        {value}
      </div>
      {typeof progress === "number" && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full ${progress >= 100 ? "bg-destructive" : "bg-primary"}`}
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
      {hint && (
        <div className="mt-0.5 text-[10px] text-muted-foreground line-clamp-2">
          {hint}
        </div>
      )}
    </div>
  );
}

function MiniStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border bg-card px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums">{value}</div>
      {hint && (
        <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
          {hint}
        </div>
      )}
    </div>
  );
}

function EmptyChart({ msg }: { msg: string }) {
  return (
    <div className="flex h-64 items-center justify-center rounded-lg bg-muted/40 text-xs text-muted-foreground">
      {msg}
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return (
    <div className="rounded-xl border bg-card p-4 text-xs text-muted-foreground">
      {msg}
    </div>
  );
}
