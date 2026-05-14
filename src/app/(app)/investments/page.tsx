"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import {
  Plus,
  LineChart,
  TrendingUp,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { NavigatingCard } from "@/components/ui/navigating-card";
import { useTransactionDialog } from "@/contexts/transaction-dialog";
import { formatINR, formatDate, cn } from "@/lib/utils";
import { MoneyValue, ToneBadge } from "@/components/ui/money-tone";
import { InvestmentActions } from "@/components/investments/investment-actions";
import type { StockQuote } from "@/app/api/market/quote/route";

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
  purchasePrice: number | null;
  purchaseExchangeRate: number | null;
  currency: string | null;
  policyNumber: string | null;
  premiumAmount: number | null;
  premiumFrequency: string | null;
  nextDueDate: string | null;
  notes: string | null;
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

  const investments = useMemo(() => data?.investments ?? [], [data]);

  const { data: rateData } = useSWR<{ rate: number }>("/api/market/rate", fetcher);
  const usdInrRate = rateData?.rate ?? 84;

  const stockSymbols = useMemo(() => {
    const s = new Set<string>();
    investments.forEach((i) => {
      if (i.kind === "STOCK" && i.symbol) s.add(i.symbol);
    });
    return [...s];
  }, [investments]);

  const quotesKey =
    stockSymbols.length > 0 ? `/api/market/quote?symbols=${stockSymbols.join(",")}` : null;

  const { data: quotes } = useSWR<StockQuote[]>(quotesKey, fetcher, {
    refreshInterval: 300_000,
  });

  const quoteMap = useMemo(() => {
    const m = new Map<string, StockQuote>();
    if (Array.isArray(quotes)) quotes.forEach((q) => m.set(q.symbol, q));
    return m;
  }, [quotes]);

  type Row = {
    investment: Investment;
    investedInr: number;
    currentInr: number;
    gain: number;
    gainPct: number;
    livePrice: number;
    dayChangePct: number;
    isLive: boolean;
  };

  const rows: Row[] = useMemo(() => {
    return investments.map((i) => {
      if (i.kind !== "STOCK") {
        const investedInr = i.amount;
        const currentInr = i.currentValue ?? i.amount;
        const gain = currentInr - investedInr;
        return {
          investment: i,
          investedInr,
          currentInr,
          gain,
          gainPct: investedInr > 0 ? (gain / investedInr) * 100 : 0,
          livePrice: 0,
          dayChangePct: 0,
          isLive: false,
        };
      }
      const qty = i.quantity ?? 0;
      const pp = i.purchasePrice ?? 0;
      const isUsd = i.currency === "USD";
      const liveRate = isUsd ? usdInrRate : 1;
      // Cost basis = stored INR `amount` (server-side maintained as
      // weighted-avg total cost). Fall back to qty × pp × stored rate for
      // legacy rows without amount.
      const investedInr =
        i.amount > 0
          ? i.amount
          : qty * pp * (isUsd ? (i.purchaseExchangeRate ?? usdInrRate) : 1);
      const quote = i.symbol ? quoteMap.get(i.symbol) : undefined;
      const livePrice = quote?.price ?? 0;
      const hasLive = livePrice > 0 && qty > 0;
      const currentInr = hasLive ? qty * livePrice * liveRate : investedInr;
      const gain = currentInr - investedInr;
      return {
        investment: i,
        investedInr,
        currentInr,
        gain,
        gainPct: investedInr > 0 ? (gain / investedInr) * 100 : 0,
        livePrice,
        dayChangePct: quote?.changePercent ?? 0,
        isLive: hasLive,
      };
    });
  }, [investments, quoteMap, usdInrRate]);

  const totalInvested = rows.reduce((s, r) => s + r.investedInr, 0);
  const totalCurrent = rows.reduce((s, r) => s + r.currentInr, 0);
  const unrealised = totalCurrent - totalInvested;
  const unrealisedPct = totalInvested > 0 ? (unrealised / totalInvested) * 100 : 0;

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
        <Stat
          label="Current value"
          value={formatINR(totalCurrent)}
          sub={
            stockSymbols.length > 0
              ? quotes
                ? "Live"
                : "Loading quotes…"
              : undefined
          }
        />
        <Stat
          label="Unrealised"
          value={`${unrealised >= 0 ? "+" : "−"}${formatINR(Math.abs(unrealised))}`}
          sub={totalInvested > 0 ? `${unrealised >= 0 ? "+" : ""}${unrealisedPct.toFixed(2)}%` : undefined}
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
        {rows.map((row) => {
          const i = row.investment;
          const isStock = i.kind === "STOCK";
          const isUsd = i.currency === "USD";
          const qtyDisplay =
            i.quantity != null
              ? i.quantity.toLocaleString("en-IN", { maximumFractionDigits: 6 })
              : null;
          const showGain = row.investedInr > 0 && row.gain !== 0 && (isStock ? row.isLive : true);
          return (
            <NavigatingCard
              key={i.id}
              href={`/investments/${i.id}`}
              className="rounded-xl border bg-card p-5 hover:bg-accent/40 transition"
              ariaLabel={`Open ${i.name}`}
            >
              <div className="flex items-start gap-3">
                <LineChart className="h-5 w-5 mt-0.5 text-sky-600 dark:text-sky-400 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold truncate">{i.name}</span>
                    <ToneBadge tone="invested" label={i.kind} />
                    {isStock && isUsd && (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">
                        USD
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground truncate">
                    {i.institution ? `${i.institution} · ` : ""}
                    {i.symbol ? `${i.symbol} · ` : ""}
                    {qtyDisplay ? `${qtyDisplay} ${isStock ? "shares" : "units"}` : ""}
                    {i.premiumFrequency ? ` · ${i.premiumFrequency} premium` : ""}
                  </div>
                  {isStock && row.isLive && (
                    <div className="mt-1 flex items-center gap-2 text-[11px] tabular-nums">
                      <span className="text-muted-foreground">
                        {isUsd ? "$" : "₹"}
                        {row.livePrice.toLocaleString(isUsd ? "en-US" : "en-IN", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </span>
                      <span
                        className={cn(
                          "inline-flex items-center gap-0.5 font-semibold",
                          row.dayChangePct >= 0
                            ? "text-emerald-700 dark:text-emerald-400"
                            : "text-red-700 dark:text-red-400",
                        )}
                      >
                        {row.dayChangePct >= 0 ? (
                          <ArrowUpRight className="h-3 w-3" />
                        ) : (
                          <ArrowDownRight className="h-3 w-3" />
                        )}
                        {row.dayChangePct >= 0 ? "+" : ""}
                        {row.dayChangePct.toFixed(2)}%
                      </span>
                    </div>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <div className="font-semibold tabular-nums">
                    {formatINR(row.currentInr)}
                  </div>
                  {showGain && (
                    <MoneyValue
                      tone={row.gain >= 0 ? "gain" : "loss"}
                      value={`${row.gain >= 0 ? "+" : "−"}${formatINR(Math.abs(row.gain))} · ${row.gain >= 0 ? "+" : ""}${row.gainPct.toFixed(2)}%`}
                      className="text-[11px] mt-0.5"
                      iconClassName="h-3 w-3"
                    />
                  )}
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    invested {formatINR(row.investedInr)}
                  </div>
                </div>
                <InvestmentActions
                  investment={{ id: i.id, name: i.name }}
                  stopPropagation
                  className="shrink-0 flex flex-col items-center gap-0.5"
                />
              </div>
              {i.nextDueDate && (
                <div className="mt-2 text-xs text-muted-foreground">
                  Next due {formatDate(i.nextDueDate)}
                  {i.premiumAmount ? ` · ${formatINR(i.premiumAmount)}` : ""}
                </div>
              )}
            </NavigatingCard>
          );
        })}
        {rows.length === 0 && !isLoading && (
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
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
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
      {sub && <div className={`mt-0.5 text-[11px] ${color}`}>{sub}</div>}
    </div>
  );
}
