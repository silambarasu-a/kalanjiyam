"use client";

import Link from "next/link";
import { use } from "react";
import useSWR from "swr";
import {
  ArrowLeft,
  Calendar,
  Droplets,
  HeartPulse,
  Scale,
  Skull,
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { formatINR, formatDate } from "@/lib/utils";
import { fetcher } from "@/lib/swr-fetcher";

type AnimalDetail = {
  animal: {
    id: string;
    tagNumber: string;
    name: string | null;
    sex: "MALE" | "FEMALE" | "UNKNOWN";
    dob: string | null;
    breed: string | null;
    color: string | null;
    notes: string | null;
    active: boolean;
    batchId: string;
    batchName: string;
    productionType: string;
    livestockId: string;
    livestockName: string;
  };
  weighings: {
    id: string;
    phase: string;
    date: string;
    sampleSize: number;
    totalKg: number;
    avgKg: number;
    notes: string | null;
  }[];
  healthLogs: {
    id: string;
    date: string;
    condition: string;
    treatment: string | null;
    cost: number | null;
    resolved: boolean;
    resolvedAt: string | null;
    notes: string | null;
  }[];
  mortality: {
    id: string;
    date: string;
    cause: string;
    culled: boolean;
    notes: string | null;
  }[];
  milkLogs: {
    id: string;
    date: string;
    totalLitres: number;
    soldLitres: number | null;
    ratePerLitre: number | null;
    notes: string | null;
  }[];
};

export default function AnimalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data, isLoading, error } = useSWR<AnimalDetail>(
    `/api/livestock-animals/${id}`,
    fetcher,
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-24" />
        <Skeleton className="h-48" />
      </div>
    );
  }
  if (error || !data?.animal) {
    return (
      <p className="text-sm text-muted-foreground">
        Animal not found.{" "}
        <Link href="/livestock" className="underline">
          Back to livestock
        </Link>
      </p>
    );
  }

  const a = data.animal;
  const { weighings, healthLogs, mortality, milkLogs } = data;
  const weighingSeries = [...weighings]
    .sort((x, y) => x.date.localeCompare(y.date))
    .map((w) => ({
      label: new Date(w.date).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
      }),
      avgKg: w.avgKg,
    }));
  const milkSeries = [...milkLogs]
    .sort((x, y) => x.date.localeCompare(y.date))
    .map((m) => ({
      label: new Date(m.date).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
      }),
      litres: m.totalLitres,
    }));
  const totalMilk = milkLogs.reduce((s, m) => s + m.totalLitres, 0);
  const openHealth = healthLogs.filter((h) => !h.resolved).length;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/livestock/${a.livestockId}/batches/${a.batchId}`}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> Back to {a.batchName}
        </Link>
      </div>

      <header className="rounded-xl border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="text-[10px]">
                {a.livestockName}
              </Badge>
              {a.active ? (
                <Badge className="bg-emerald-100 text-emerald-800 text-[10px] dark:bg-emerald-950 dark:text-emerald-300">
                  Active
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px]">
                  Inactive
                </Badge>
              )}
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground capitalize">
                {a.sex.toLowerCase()}
              </span>
              {a.dob && (
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Calendar className="h-3 w-3" /> Born {formatDate(a.dob)}
                </span>
              )}
            </div>
            <h1 className="mt-1.5 text-2xl font-semibold tracking-tight">
              #{a.tagNumber}
              {a.name && (
                <span className="ml-2 text-base font-normal text-muted-foreground">
                  · {a.name}
                </span>
              )}
            </h1>
            {(a.breed || a.color) && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {[a.breed, a.color].filter(Boolean).join(" · ")}
              </p>
            )}
            {a.notes && (
              <p className="mt-2 max-w-2xl whitespace-pre-wrap text-sm text-muted-foreground">
                {a.notes}
              </p>
            )}
          </div>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          icon={<Scale className="h-3.5 w-3.5" />}
          label="Weighings"
          value={`${weighings.length}`}
          hint={
            weighings.length > 0
              ? `Latest ${weighings[0].avgKg.toFixed(2)} kg`
              : undefined
          }
        />
        <KpiCard
          icon={<HeartPulse className="h-3.5 w-3.5" />}
          label="Health logs"
          value={`${healthLogs.length}`}
          hint={openHealth > 0 ? `${openHealth} open` : "No open cases"}
          tone={openHealth > 0 ? "negative" : "default"}
        />
        <KpiCard
          icon={<Droplets className="h-3.5 w-3.5" />}
          label="Milk recorded"
          value={`${totalMilk.toFixed(1)} L`}
          hint={
            milkLogs.length > 0
              ? `${milkLogs.length} log${milkLogs.length === 1 ? "" : "s"}`
              : undefined
          }
        />
        <KpiCard
          icon={<Skull className="h-3.5 w-3.5" />}
          label="Mortality"
          value={mortality.length > 0 ? "Recorded" : "—"}
          hint={
            mortality.length > 0
              ? `${mortality[0].cause.toLowerCase()}${mortality[0].culled ? " · culled" : ""}`
              : undefined
          }
          tone={mortality.length > 0 ? "negative" : "default"}
        />
      </section>

      <Tabs defaultValue="weighings" className="space-y-4">
        <TabsList>
          <TabsTrigger value="weighings">
            Weighings ({weighings.length})
          </TabsTrigger>
          <TabsTrigger value="health">
            Health ({healthLogs.length})
          </TabsTrigger>
          <TabsTrigger value="milk">Milk ({milkLogs.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="weighings" className="space-y-4">
          {weighingSeries.length > 1 && (
            <div className="rounded-xl border bg-card p-4">
              <h2 className="mb-2 text-sm font-semibold">Weight curve</h2>
              <div className="h-56">
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
                      formatter={(v) => `${Number(v).toFixed(2)} kg`}
                      contentStyle={{ fontSize: 11, borderRadius: 6 }}
                    />
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
            </div>
          )}
          {weighings.length === 0 ? (
            <Empty msg="No per-animal weighings yet." />
          ) : (
            <DataTable
              headers={["Date", "Phase", "Sample", "Total kg", "Avg kg", "Notes"]}
              rows={weighings.map((w) => [
                formatDate(w.date),
                w.phase.toLowerCase(),
                String(w.sampleSize),
                w.totalKg.toFixed(3),
                w.avgKg.toFixed(3),
                w.notes ?? "—",
              ])}
              key_={(_, i) => weighings[i].id}
              rightAlignCols={[2, 3, 4]}
            />
          )}
        </TabsContent>

        <TabsContent value="health">
          {healthLogs.length === 0 ? (
            <Empty msg="No per-animal health incidents." />
          ) : (
            <DataTable
              headers={["Date", "Condition", "Treatment", "Cost", "Status"]}
              rows={healthLogs.map((h) => [
                formatDate(h.date),
                h.condition,
                h.treatment ?? "—",
                h.cost != null ? formatINR(h.cost) : "—",
                h.resolved
                  ? `Resolved${h.resolvedAt ? ` · ${formatDate(h.resolvedAt)}` : ""}`
                  : "Open",
              ])}
              key_={(_, i) => healthLogs[i].id}
              rightAlignCols={[3]}
            />
          )}
        </TabsContent>

        <TabsContent value="milk">
          {milkSeries.length > 1 && (
            <div className="rounded-xl border bg-card p-4">
              <h2 className="mb-2 text-sm font-semibold">Yield curve</h2>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
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
                    <Line
                      type="monotone"
                      dataKey="litres"
                      stroke="#06b6d4"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
          {milkLogs.length === 0 ? (
            <Empty msg="No per-animal milk yield recorded." />
          ) : (
            <DataTable
              headers={["Date", "Litres", "Sold", "Rate"]}
              rows={milkLogs.map((m) => [
                formatDate(m.date),
                m.totalLitres.toFixed(2),
                m.soldLitres != null ? m.soldLitres.toFixed(2) : "—",
                m.ratePerLitre != null ? formatINR(m.ratePerLitre) : "—",
              ])}
              key_={(_, i) => milkLogs[i].id}
              rightAlignCols={[1, 2, 3]}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function DataTable({
  headers,
  rows,
  key_,
  rightAlignCols = [],
}: {
  headers: string[];
  rows: string[][];
  key_: (row: string[], index: number) => string;
  rightAlignCols?: number[];
}) {
  const isRight = (i: number) => rightAlignCols.includes(i);
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground">
          <tr>
            {headers.map((h, i) => (
              <th
                key={h}
                className={`px-3 py-2 ${isRight(i) ? "text-right" : "text-left"} font-medium`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r, i) => (
            <tr key={key_(r, i)} className="hover:bg-muted/40">
              {r.map((cell, j) => (
                <td
                  key={j}
                  className={`px-3 py-2 text-xs ${isRight(j) ? "text-right tabular-nums" : ""}`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  hint,
  tone = "default",
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "negative";
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
      {hint && (
        <div className="mt-0.5 text-[10px] text-muted-foreground line-clamp-1">
          {hint}
        </div>
      )}
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
