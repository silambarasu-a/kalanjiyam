"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Plus, LineChart, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTransactionDialog } from "@/contexts/transaction-dialog";
import { formatINR, formatDate } from "@/lib/utils";
import { MoneyValue, ToneBadge } from "@/components/ui/money-tone";

type Investment = {
  id: string;
  kind: "STOCK" | "FD" | "RD" | "MUTUAL_FUND" | "SIP" | "INSURANCE" | "GOLD" | "OTHER";
  name: string;
  institution: string | null;
  amount: number;
  currentValue: number | null;
  interestRate: number | null;
  startedAt: string;
  maturityAt: string | null;
  active: boolean;
  symbol: string | null;
  quantity: number | null;
  policyNumber: string | null;
  premiumAmount: number | null;
  premiumFrequency: string | null;
  nextDueDate: string | null;
};

type Account = {
  id: string;
  name: string;
  kind: string;
  balance: number;
  availableLimit: number | null;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const KIND_OPTIONS: { value: Investment["kind"]; label: string }[] = [
  { value: "STOCK", label: "Stock" },
  { value: "MUTUAL_FUND", label: "Mutual fund" },
  { value: "SIP", label: "SIP" },
  { value: "FD", label: "Fixed deposit" },
  { value: "RD", label: "Recurring deposit" },
  { value: "INSURANCE", label: "Insurance" },
  { value: "GOLD", label: "Gold" },
  { value: "OTHER", label: "Other" },
];

export default function InvestmentsPage() {
  const [kindFilter, setKindFilter] = useState<"ALL" | Investment["kind"]>("ALL");
  const url =
    kindFilter === "ALL" ? "/api/investments" : `/api/investments?kind=${kindFilter}`;
  const { data, isLoading } = useSWR<{ investments: Investment[] }>(url, fetcher);
  const { openDialog } = useTransactionDialog();

  const investments = data?.investments ?? [];
  const totalInvested = investments.reduce((s, i) => s + i.amount, 0);
  const totalCurrent = investments.reduce(
    (s, i) => s + (i.currentValue ?? i.amount),
    0
  );
  const unrealised = totalCurrent - totalInvested;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Investments</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Stocks, mutual funds, SIPs, FDs, and insurance. {investments.length} active
            holding{investments.length === 1 ? "" : "s"}
            {totalInvested > 0 ? ` · ${formatINR(totalInvested)} invested` : ""}.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/investments/stocks"
            className="inline-flex items-center gap-2 rounded-lg border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors"
          >
            <TrendingUp className="h-4 w-4" /> Stocks portfolio
          </Link>
          <Button
            onClick={() => openDialog("INVESTMENT", { defaultCreatingNew: true })}
            className="gap-2"
          >
            <Plus className="h-4 w-4" /> New investment
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Invested" value={formatINR(totalInvested)} />
        <Stat label="Current value" value={formatINR(totalCurrent)} />
        <Stat
          label="Unrealised"
          value={`${unrealised >= 0 ? "+" : "−"}${formatINR(Math.abs(unrealised))}`}
          tone={unrealised >= 0 ? "primary" : "destructive"}
        />
        <Stat label="Holdings" value={String(investments.length)} />
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {(["ALL", ...KIND_OPTIONS.map((k) => k.value)] as const).map((k) => (
          <Button
            key={k}
            size="sm"
            variant={kindFilter === k ? "default" : "outline"}
            onClick={() => setKindFilter(k as typeof kindFilter)}
          >
            {k === "ALL" ? "All" : KIND_OPTIONS.find((o) => o.value === k)?.label ?? k}
          </Button>
        ))}
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {investments.map((i) => (
          <Link
            key={i.id}
            href={`/investments/${i.id}`}
            className="rounded-xl border bg-card p-5 hover:bg-accent/40 transition"
          >
            <div className="flex items-start gap-3">
              <LineChart className="h-5 w-5 mt-0.5 text-sky-600 dark:text-sky-400 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold truncate">{i.name}</span>
                  <ToneBadge tone="invested" label={i.kind} />
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground truncate">
                  {i.institution ? `${i.institution} · ` : ""}
                  {i.symbol ? `${i.symbol} · ` : ""}
                  {i.quantity != null ? `${i.quantity} units · ` : ""}
                  {i.premiumFrequency ? `${i.premiumFrequency} premium` : ""}
                </div>
              </div>
              <div className="text-right">
                <div className="font-semibold tabular-nums">
                  {formatINR(i.currentValue ?? i.amount)}
                </div>
                {i.currentValue != null && i.currentValue !== i.amount && (
                  <MoneyValue
                    tone={i.currentValue > i.amount ? "gain" : "loss"}
                    value={`${i.currentValue > i.amount ? "+" : "−"}${formatINR(Math.abs(i.currentValue - i.amount))}`}
                    className="text-[11px] mt-0.5"
                    iconClassName="h-3 w-3"
                  />
                )}
              </div>
            </div>
            {i.nextDueDate && (
              <div className="mt-2 text-xs text-muted-foreground">
                Next due {formatDate(i.nextDueDate)}
                {i.premiumAmount ? ` · ${formatINR(i.premiumAmount)}` : ""}
              </div>
            )}
          </Link>
        ))}
        {investments.length === 0 && !isLoading && (
          <div className="col-span-full rounded-xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
            No investments yet. Add stocks, SIPs, FDs, or insurance to start tracking.
          </div>
        )}
      </div>

    </div>
  );
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "primary" | "destructive";
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
      <div className={`mt-1 text-xl font-semibold ${color}`}>{value}</div>
    </div>
  );
}
