"use client";

import { useMemo, useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import Link from "next/link";
import {
  CalendarClock,
  CreditCard,
  Pause,
  Play,
  Plus,
  Repeat,
  Search,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatINR } from "@/lib/utils";
import { SubscriptionForm } from "@/components/subscriptions/subscription-form";
import { PaySubscriptionDialog } from "@/components/subscriptions/pay-subscription-dialog";
import { fetcher } from "@/lib/swr-fetcher";

type Sub = {
  id: string;
  name: string;
  amount: number;
  cycle: "WEEKLY" | "MONTHLY" | "QUARTERLY" | "HALF_YEARLY" | "YEARLY";
  status: "ACTIVE" | "PAUSED" | "CANCELLED";
  nextBillingDate: string;
  autoPay: boolean;
  account: { id: string; name: string; kind: string } | null;
  card: { id: string; name: string } | null;
  category: { id: string; name: string } | null;
};


const STATUS_TABS: { value: "ALL" | Sub["status"]; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "ACTIVE", label: "Active" },
  { value: "PAUSED", label: "Paused" },
  { value: "CANCELLED", label: "Cancelled" },
];

/**
 * Normalize a per-cycle amount to a monthly figure for the MRR rollup.
 * Weekly is treated as exactly 4 charges/month (close enough for a KPI;
 * the precise number drifts ±3% across months).
 */
function monthlyEquivalent(amount: number, cycle: Sub["cycle"]): number {
  switch (cycle) {
    case "WEEKLY":
      return amount * 4;
    case "MONTHLY":
      return amount;
    case "QUARTERLY":
      return amount / 3;
    case "HALF_YEARLY":
      return amount / 6;
    case "YEARLY":
      return amount / 12;
  }
}

function cycleLabel(c: Sub["cycle"]): string {
  return (
    {
      WEEKLY: "Weekly",
      MONTHLY: "Monthly",
      QUARTERLY: "Quarterly",
      HALF_YEARLY: "Half-yearly",
      YEARLY: "Yearly",
    } as const
  )[c];
}

function StatusBadge({ status }: { status: Sub["status"] }) {
  const cls =
    status === "ACTIVE"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
      : status === "PAUSED"
        ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
        : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}>
      {status}
    </span>
  );
}

function daysUntil(iso: string): number {
  const due = new Date(iso);
  due.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

export default function SubscriptionsPage() {
  const [tab, setTab] = useState<(typeof STATUS_TABS)[number]["value"]>("ACTIVE");
  const [search, setSearch] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [payTarget, setPayTarget] = useState<Sub | null>(null);

  const { data, isLoading } = useSWR<{ subscriptions: Sub[] }>(
    "/api/subscriptions",
    fetcher,
  );
  const all = useMemo(() => data?.subscriptions ?? [], [data]);

  const filtered = useMemo(() => {
    let rows = all;
    if (tab !== "ALL") rows = rows.filter((r) => r.status === tab);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter((r) => r.name.toLowerCase().includes(q));
    }
    return rows;
  }, [all, tab, search]);

  const active = all.filter((s) => s.status === "ACTIVE");
  const mrr = active.reduce(
    (sum, s) => sum + monthlyEquivalent(s.amount, s.cycle),
    0,
  );
  const annual = mrr * 12;
  const dueSoon = active.filter((s) => daysUntil(s.nextBillingDate) <= 7);
  const dueSoonSum = dueSoon.reduce((sum, s) => sum + s.amount, 0);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Subscriptions</h1>
          <p className="text-sm text-muted-foreground">
            Track Netflix, Spotify, Prime, and other recurring charges.
          </p>
        </div>
        <Button onClick={() => setNewOpen(true)} className="gap-1.5">
          <Plus className="h-4 w-4" /> Add subscription
        </Button>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          label="Active"
          value={active.length.toString()}
          icon={<Repeat className="h-4 w-4" />}
        />
        <KpiCard
          label="Monthly cost"
          value={formatINR(mrr)}
          icon={<Wallet className="h-4 w-4" />}
        />
        <KpiCard
          label="Annual run-rate"
          value={formatINR(annual)}
          icon={<CreditCard className="h-4 w-4" />}
        />
        <KpiCard
          label="Due in 7 days"
          value={`${dueSoon.length} · ${formatINR(dueSoonSum)}`}
          icon={<CalendarClock className="h-4 w-4" />}
          tone={dueSoon.length > 0 ? "warn" : "muted"}
        />
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg border bg-card p-0.5 text-xs">
          {STATUS_TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              className={`rounded-md px-3 py-1.5 font-medium transition ${
                tab === t.value
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            className="pl-8 text-xs"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/30 px-6 py-12 text-center">
          <Repeat className="mx-auto h-8 w-8 text-muted-foreground" />
          <h3 className="mt-3 text-sm font-medium">No subscriptions yet</h3>
          <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
            Add your first subscription to start tracking recurring charges and
            get a reminder before each cycle.
          </p>
          <Button
            onClick={() => setNewOpen(true)}
            size="sm"
            className="mt-4 gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" /> Add subscription
          </Button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full whitespace-nowrap text-sm">
            <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Service</th>
                <th className="px-3 py-2 text-left font-medium hidden md:table-cell">Cycle</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
                <th className="px-3 py-2 text-left font-medium">Next billing</th>
                <th className="px-3 py-2 text-left font-medium hidden md:table-cell">Source</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((s) => {
                const days = daysUntil(s.nextBillingDate);
                return (
                  <tr key={s.id} className="hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <Link
                        href={`/subscriptions/${s.id}`}
                        className="font-medium hover:underline"
                      >
                        {s.name}
                      </Link>
                      {s.autoPay && (
                        <Badge variant="secondary" className="ml-2 text-[9px]">
                          Auto-pay
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground hidden md:table-cell">
                      {cycleLabel(s.cycle)}
                    </td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">
                      {formatINR(s.amount)}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {new Date(s.nextBillingDate).toLocaleDateString("en-IN", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })}
                      <span
                        className={`ml-1.5 text-[10px] ${
                          days < 0
                            ? "text-rose-600 dark:text-rose-400"
                            : days <= 3
                              ? "text-amber-600 dark:text-amber-400"
                              : "text-muted-foreground"
                        }`}
                      >
                        {days < 0
                          ? `${Math.abs(days)}d overdue`
                          : days === 0
                            ? "today"
                            : `in ${days}d`}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground hidden md:table-cell">
                      {s.account?.name ?? s.card?.name ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={s.status} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      {s.status === "ACTIVE" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setPayTarget(s)}
                          className="h-7 gap-1 text-xs"
                        >
                          <Play className="h-3 w-3" /> Pay
                        </Button>
                      )}
                      {s.status === "PAUSED" && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Pause className="h-3 w-3" /> Paused
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add subscription</DialogTitle>
          </DialogHeader>
          {newOpen && (
            <SubscriptionForm
              onSaved={() => {
                setNewOpen(false);
                globalMutate("/api/subscriptions");
              }}
              onCancel={() => setNewOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      {payTarget && (
        <PaySubscriptionDialog
          open={!!payTarget}
          onOpenChange={(o) => !o && setPayTarget(null)}
          subscription={{
            id: payTarget.id,
            name: payTarget.name,
            amount: payTarget.amount,
            nextBillingDate: payTarget.nextBillingDate,
            accountId: payTarget.account?.id ?? null,
            cardId: payTarget.card?.id ?? null,
          }}
          onPaid={() => {
            globalMutate("/api/subscriptions");
          }}
        />
      )}
    </div>
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
