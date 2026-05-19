"use client";

import { useMemo, useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import Link from "next/link";
import {
  AlertTriangle,
  CalendarClock,
  Plus,
  Search,
  Wallet,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/native-select";
import { formatINR } from "@/lib/utils";
import {
  UtilityKindIcon,
  utilityKindLabel,
  UTILITY_KINDS,
  type UtilityKindValue,
} from "@/components/bills/utility-kind";
import { UtilityProviderForm } from "@/components/bills/utility-provider-form";

type Provider = {
  id: string;
  kind: UtilityKindValue;
  providerName: string;
  connectionNumber: string | null;
  advanceBalance: number;
  autoPay: boolean;
  status: "ACTIVE" | "INACTIVE";
  account: { id: string; name: string; kind: string } | null;
  card: { id: string; name: string } | null;
  summary: {
    unpaidCount: number;
    overdueCount: number;
    nextDueDate: string | null;
    lastBillDate: string | null;
  };
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function BillsPage() {
  const { data, isLoading } = useSWR<{ providers: Provider[] }>(
    "/api/utility-providers",
    fetcher,
  );
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<"ALL" | UtilityKindValue>("ALL");
  const [newOpen, setNewOpen] = useState(false);

  const providers = useMemo(() => data?.providers ?? [], [data]);
  const filtered = useMemo(() => {
    let rows = providers.filter((p) => p.status === "ACTIVE");
    if (kindFilter !== "ALL") rows = rows.filter((r) => r.kind === kindFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(
        (r) =>
          r.providerName.toLowerCase().includes(q) ||
          (r.connectionNumber ?? "").toLowerCase().includes(q),
      );
    }
    return rows;
  }, [providers, kindFilter, search]);

  const totalAdvance = providers.reduce((s, p) => s + p.advanceBalance, 0);
  const unpaidCount = providers.reduce((s, p) => s + p.summary.unpaidCount, 0);
  const overdueCount = providers.reduce((s, p) => s + p.summary.overdueCount, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const oneWeek = new Date(today);
  oneWeek.setDate(oneWeek.getDate() + 7);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Bills</h1>
          <p className="text-sm text-muted-foreground">
            Electricity, internet, mobile, gas. Track per operator with advance
            balances + unit consumption.
          </p>
        </div>
        <Button onClick={() => setNewOpen(true)} className="gap-1.5">
          <Plus className="h-4 w-4" /> Add provider
        </Button>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          label="Active providers"
          value={providers.filter((p) => p.status === "ACTIVE").length.toString()}
          icon={<Zap className="h-4 w-4" />}
        />
        <KpiCard
          label="Total advance held"
          value={formatINR(totalAdvance)}
          icon={<Wallet className="h-4 w-4" />}
        />
        <KpiCard
          label="Unpaid bills"
          value={unpaidCount.toString()}
          icon={<CalendarClock className="h-4 w-4" />}
        />
        <KpiCard
          label="Overdue"
          value={overdueCount.toString()}
          icon={<AlertTriangle className="h-4 w-4" />}
          tone={overdueCount > 0 ? "warn" : "muted"}
        />
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <div className="w-44">
          <NativeSelect
            value={kindFilter}
            onChange={(v) => setKindFilter(v as typeof kindFilter)}
            options={[
              { value: "ALL", label: "All kinds" },
              ...UTILITY_KINDS.map((u) => ({ value: u.value, label: u.label })),
            ]}
          />
        </div>
        <div className="relative flex-1 max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search providers…"
            className="pl-8 text-xs"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/30 px-6 py-12 text-center">
          <Zap className="mx-auto h-8 w-8 text-muted-foreground" />
          <h3 className="mt-3 text-sm font-medium">No providers yet</h3>
          <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
            Add an electricity, internet, or mobile provider to start tracking
            bills, consumption, and advance balances.
          </p>
          <Button onClick={() => setNewOpen(true)} size="sm" className="mt-4 gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Add provider
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => (
            <ProviderCard key={p.id} provider={p} />
          ))}
        </div>
      )}

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add utility provider</DialogTitle>
          </DialogHeader>
          {newOpen && (
            <UtilityProviderForm
              onSaved={() => {
                setNewOpen(false);
                globalMutate("/api/utility-providers");
              }}
              onCancel={() => setNewOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProviderCard({ provider }: { provider: Provider }) {
  const nextDue = provider.summary.nextDueDate
    ? new Date(provider.summary.nextDueDate)
    : null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const overdue =
    nextDue && nextDue < today ? Math.round((today.getTime() - nextDue.getTime()) / 86_400_000) : 0;
  return (
    <Link
      href={`/bills/providers/${provider.id}`}
      className="group block rounded-lg border bg-card p-4 transition hover:shadow-md"
    >
      <div className="flex items-start gap-3">
        <div className="rounded-md bg-muted p-2 group-hover:bg-foreground/10">
          <UtilityKindIcon kind={provider.kind} className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="truncate text-sm font-semibold">
              {provider.providerName}
            </h3>
            {provider.summary.overdueCount > 0 && (
              <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-medium text-rose-700 dark:bg-rose-950 dark:text-rose-300">
                {provider.summary.overdueCount} overdue
              </span>
            )}
          </div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {utilityKindLabel(provider.kind)}
            {provider.connectionNumber ? ` · #${provider.connectionNumber}` : ""}
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-md bg-muted/40 px-2 py-1.5">
          <div className="text-[10px] uppercase text-muted-foreground">Advance</div>
          <div className="mt-0.5 font-semibold tabular-nums">
            {formatINR(provider.advanceBalance)}
          </div>
        </div>
        <div className="rounded-md bg-muted/40 px-2 py-1.5">
          <div className="text-[10px] uppercase text-muted-foreground">Unpaid</div>
          <div className="mt-0.5 font-semibold tabular-nums">
            {provider.summary.unpaidCount}
          </div>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>
          {nextDue
            ? overdue > 0
              ? `Overdue ${overdue}d`
              : `Next due ${nextDue.toLocaleDateString("en-IN", {
                  day: "2-digit",
                  month: "short",
                })}`
            : "No active bills"}
        </span>
        <span className="truncate">
          {provider.card?.name ?? provider.account?.name ?? "No default source"}
        </span>
      </div>
    </Link>
  );
}

function KpiCard({
  label,
  value,
  icon,
  tone = "neutral",
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone?: "neutral" | "warn" | "muted";
}) {
  const toneCls =
    tone === "warn"
      ? "text-amber-600 dark:text-amber-400"
      : tone === "muted"
        ? "text-muted-foreground"
        : "text-foreground";
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${toneCls}`}>
        {value}
      </div>
    </div>
  );
}
