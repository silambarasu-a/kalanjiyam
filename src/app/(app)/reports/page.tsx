"use client";

import { useState } from "react";
import useSWR from "swr";
import {
  BarChart3,
  Sprout,
  PawPrint,
  Users,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatINR, formatDate } from "@/lib/utils";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type Tab = "cashflow" | "crops" | "livestock" | "members";

export default function ReportsPage() {
  const [tab, setTab] = useState<Tab>("cashflow");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" /> Reports
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Cashflow, farm P&amp;L, and member balances across the whole workspace.
        </p>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {([
          { value: "cashflow", label: "Cashflow", icon: BarChart3 },
          { value: "crops", label: "Crops P&L", icon: Sprout },
          { value: "livestock", label: "Livestock P&L", icon: PawPrint },
          { value: "members", label: "Member ledger", icon: Users },
        ] as const).map((t) => {
          const Icon = t.icon;
          return (
            <Button
              key={t.value}
              size="sm"
              variant={tab === t.value ? "default" : "outline"}
              onClick={() => setTab(t.value)}
              className="gap-1.5"
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </Button>
          );
        })}
      </div>

      {tab === "cashflow" && <CashflowTab />}
      {tab === "crops" && <CropsTab />}
      {tab === "livestock" && <LivestockTab />}
      {tab === "members" && <MembersTab />}
    </div>
  );
}

function CashflowTab() {
  const [months, setMonths] = useState(12);
  const { data, isLoading } = useSWR<{
    series: { month: string; income: number; expense: number; net: number }[];
    totals: { income: number; expense: number; net: number };
    topIncome: { id: string; name: string; amount: number }[];
    topExpense: { id: string; name: string; amount: number }[];
  }>(`/api/reports/cashflow?months=${months}`, fetcher);

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!data) return null;

  const maxBar =
    Math.max(1, ...data.series.map((s) => Math.max(s.income, s.expense))) || 1;

  return (
    <div className="space-y-6">
      <div className="flex gap-2">
        {[3, 6, 12, 24].map((m) => (
          <Button
            key={m}
            size="sm"
            variant={months === m ? "default" : "outline"}
            onClick={() => setMonths(m)}
          >
            {m}mo
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Income" value={formatINR(data.totals.income)} tone="primary" />
        <Stat label="Expense" value={formatINR(data.totals.expense)} tone="destructive" />
        <Stat
          label="Net"
          value={`${data.totals.net >= 0 ? "+" : "−"}${formatINR(Math.abs(data.totals.net))}`}
          tone={data.totals.net >= 0 ? "primary" : "destructive"}
          highlight
        />
      </div>

      <div className="rounded-xl border bg-card p-5">
        <h2 className="text-sm font-semibold mb-3">Monthly trend</h2>
        <div className="space-y-1.5">
          {data.series.map((s) => (
            <div key={s.month} className="grid grid-cols-[72px_1fr_96px] items-center gap-3">
              <div className="text-xs text-muted-foreground">{s.month}</div>
              <div className="h-6 relative bg-muted rounded-md overflow-hidden">
                <div
                  className="absolute inset-y-0 left-0 bg-primary/70 transition-all"
                  style={{ width: `${(s.income / maxBar) * 50}%` }}
                />
                <div
                  className="absolute inset-y-0 bg-destructive/70 transition-all"
                  style={{
                    left: "50%",
                    width: `${(s.expense / maxBar) * 50}%`,
                  }}
                />
                <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
              </div>
              <div
                className={`text-right text-xs font-medium ${s.net >= 0 ? "text-primary" : "text-destructive"}`}
              >
                {s.net >= 0 ? "+" : "−"}
                {formatINR(Math.abs(s.net))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <CategoryList title="Top income" rows={data.topIncome} tone="primary" />
        <CategoryList title="Top expense" rows={data.topExpense} tone="destructive" />
      </div>
    </div>
  );
}

function CropsTab() {
  const { data, isLoading } = useSWR<{
    batches: {
      batchId: string;
      batchName: string;
      crop: { id: string; name: string };
      status: string;
      active: boolean;
      income: number;
      expense: number;
      net: number;
    }[];
    byCrop: { id: string; name: string; batches: number; income: number; expense: number; net: number }[];
    totals: { income: number; expense: number; net: number };
  }>("/api/reports/crop-pnl", fetcher);
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Income" value={formatINR(data.totals.income)} tone="primary" />
        <Stat label="Expense" value={formatINR(data.totals.expense)} tone="destructive" />
        <Stat
          label="Net"
          value={`${data.totals.net >= 0 ? "+" : "−"}${formatINR(Math.abs(data.totals.net))}`}
          tone={data.totals.net >= 0 ? "primary" : "destructive"}
          highlight
        />
      </div>
      <section>
        <h2 className="text-sm font-semibold mb-2">By crop</h2>
        <div className="rounded-xl border bg-card divide-y">
          {data.byCrop.map((c) => (
            <Row
              key={c.id}
              title={c.name}
              subtitle={`${c.batches} batch${c.batches === 1 ? "" : "es"}`}
              income={c.income}
              expense={c.expense}
              net={c.net}
            />
          ))}
          {data.byCrop.length === 0 && <Empty label="No crop data yet" />}
        </div>
      </section>
      <section>
        <h2 className="text-sm font-semibold mb-2">By batch</h2>
        <div className="rounded-xl border bg-card divide-y">
          {data.batches.map((b) => (
            <Row
              key={b.batchId}
              title={`${b.crop.name} · ${b.batchName}`}
              subtitle={b.status + (b.active ? "" : " · closed")}
              income={b.income}
              expense={b.expense}
              net={b.net}
            />
          ))}
          {data.batches.length === 0 && <Empty label="No batches yet" />}
        </div>
      </section>
    </div>
  );
}

function LivestockTab() {
  const { data, isLoading } = useSWR<{
    batches: {
      batchId: string;
      batchName: string;
      livestock: { id: string; name: string };
      active: boolean;
      currentCount: number;
      initialCount: number;
      startDate: string;
      income: number;
      expense: number;
      net: number;
    }[];
    totals: { income: number; expense: number; net: number };
  }>("/api/reports/livestock-pnl", fetcher);
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Income" value={formatINR(data.totals.income)} tone="primary" />
        <Stat label="Expense" value={formatINR(data.totals.expense)} tone="destructive" />
        <Stat
          label="Net"
          value={`${data.totals.net >= 0 ? "+" : "−"}${formatINR(Math.abs(data.totals.net))}`}
          tone={data.totals.net >= 0 ? "primary" : "destructive"}
          highlight
        />
      </div>
      <div className="rounded-xl border bg-card divide-y">
        {data.batches.map((b) => (
          <Row
            key={b.batchId}
            title={`${b.livestock.name} · ${b.batchName}`}
            subtitle={`${b.currentCount} head (from ${b.initialCount}) · started ${formatDate(b.startDate)}`}
            income={b.income}
            expense={b.expense}
            net={b.net}
          />
        ))}
        {data.batches.length === 0 && <Empty label="No livestock batches yet" />}
      </div>
    </div>
  );
}

function MembersTab() {
  const { data, isLoading } = useSWR<{
    members: {
      id: string;
      name: string;
      relationship: string | null;
      active: boolean;
      totalCharged: number;
      totalSettled: number;
      outstanding: number;
      chargeCount: number;
    }[];
    totals: { totalCharged: number; totalSettled: number; outstanding: number };
  }>("/api/reports/member-ledger", fetcher);
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Total charged" value={formatINR(data.totals.totalCharged)} />
        <Stat label="Settled" value={formatINR(data.totals.totalSettled)} />
        <Stat
          label="Outstanding"
          value={formatINR(data.totals.outstanding)}
          tone="primary"
          highlight
        />
      </div>
      <div className="rounded-xl border bg-card divide-y">
        {data.members.map((m) => (
          <div key={m.id} className="flex items-center gap-3 px-5 py-3">
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{m.name}</div>
              <div className="text-xs text-muted-foreground">
                {m.relationship ?? "—"} · {m.chargeCount} charge{m.chargeCount === 1 ? "" : "s"}
              </div>
            </div>
            <div className="text-right">
              <div
                className={`font-semibold ${m.outstanding > 0 ? "text-primary" : "text-muted-foreground"}`}
              >
                {formatINR(m.outstanding)}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {formatINR(m.totalSettled)} settled of {formatINR(m.totalCharged)}
              </div>
            </div>
          </div>
        ))}
        {data.members.length === 0 && <Empty label="No contacts yet" />}
      </div>
    </div>
  );
}

function Row({
  title,
  subtitle,
  income,
  expense,
  net,
}: {
  title: string;
  subtitle: string;
  income: number;
  expense: number;
  net: number;
}) {
  return (
    <div className="flex items-center gap-3 px-5 py-3">
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{title}</div>
        <div className="text-xs text-muted-foreground truncate">{subtitle}</div>
      </div>
      <div className="hidden md:block text-xs text-right min-w-20">
        <div className="text-primary">+{formatINR(income)}</div>
        <div className="text-destructive">−{formatINR(expense)}</div>
      </div>
      <div
        className={`flex items-center gap-1 text-right font-semibold ${net >= 0 ? "text-primary" : "text-destructive"}`}
      >
        {net >= 0 ? (
          <TrendingUp className="h-4 w-4" />
        ) : (
          <TrendingDown className="h-4 w-4" />
        )}
        {formatINR(Math.abs(net))}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "default",
  highlight,
}: {
  label: string;
  value: string;
  tone?: "default" | "primary" | "destructive";
  highlight?: boolean;
}) {
  const color =
    tone === "primary"
      ? "text-primary"
      : tone === "destructive"
        ? "text-destructive"
        : "text-foreground";
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 ${highlight ? "text-2xl" : "text-lg"} font-semibold ${color}`}>
        {value}
      </div>
    </div>
  );
}

function CategoryList({
  title,
  rows,
  tone,
}: {
  title: string;
  rows: { id: string; name: string; amount: number }[];
  tone: "primary" | "destructive";
}) {
  const totalMax = Math.max(1, ...rows.map((r) => r.amount));
  const color = tone === "primary" ? "bg-primary" : "bg-destructive";
  return (
    <div className="rounded-xl border bg-card p-5">
      <h3 className="text-sm font-semibold mb-3">{title}</h3>
      {rows.length === 0 ? (
        <div className="text-sm text-muted-foreground">None in this window.</div>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.id}>
              <div className="flex items-center justify-between text-sm">
                <span className="truncate">{r.name}</span>
                <span className="font-medium">{formatINR(r.amount)}</span>
              </div>
              <div className="mt-1 h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full ${color}`}
                  style={{ width: `${(r.amount / totalMax) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div className="px-5 py-8 text-sm text-muted-foreground text-center">{label}</div>
  );
}
