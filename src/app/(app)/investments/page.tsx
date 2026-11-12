"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import {
  Plus,
  TrendingUp,
  Gem,
  ChartPie,
  Repeat,
  Landmark,
  PiggyBank,
  ShieldCheck,
  Briefcase,
  type LucideIcon,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { useTransactionDialog } from "@/contexts/transaction-dialog";
import { formatINR, cn } from "@/lib/utils";
import {
  HoldingCard,
  type HoldingListItem,
  type InvestmentKind,
} from "@/components/investments/holding-card";
import {
  amfiSchemeCode,
  isFundKind,
  valueHolding,
  type HoldingValue,
} from "@/lib/investment-valuation";
import type { StockQuote } from "@/app/api/market/quote/route";
import type { MfNavResponse } from "@/app/api/market/mf-nav/route";
import { fetcher } from "@/lib/swr-fetcher";

/** The sections of the page, in the order they are shown. */
const GROUPS: { kind: InvestmentKind; label: string; chip: string; icon: LucideIcon }[] = [
  { kind: "STOCK", label: "Stocks", chip: "Stocks", icon: TrendingUp },
  { kind: "MUTUAL_FUND", label: "Mutual funds", chip: "Mutual funds", icon: ChartPie },
  { kind: "SIP", label: "SIPs", chip: "SIPs", icon: Repeat },
  { kind: "FD", label: "Fixed deposits", chip: "Fixed deposits", icon: Landmark },
  { kind: "RD", label: "Recurring deposits", chip: "Recurring deposits", icon: PiggyBank },
  { kind: "INSURANCE", label: "Insurance", chip: "Insurance", icon: ShieldCheck },
  { kind: "GOLD", label: "Gold", chip: "Gold", icon: Gem },
  { kind: "OTHER", label: "Other", chip: "Other", icon: Briefcase },
];

type SortKey = "NAME" | "VALUE" | "DATE";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "NAME", label: "Name (A → Z)" },
  { value: "VALUE", label: "Value (low → high)" },
  { value: "DATE", label: "Maturity / next due (soonest)" },
];

type Row = {
  holding: HoldingListItem;
  value: HoldingValue;
  livePrice: number;
  dayChangePct: number;
};

/**
 * The date a holding next needs attention on: its next instalment or
 * premium, else its maturity. Holdings with neither sort last.
 */
function nextDate(h: HoldingListItem): number {
  const d = h.nextDueDate ?? h.maturityAt;
  return d ? new Date(d).getTime() : Number.POSITIVE_INFINITY;
}

const byName = (a: Row, b: Row) =>
  a.holding.name.localeCompare(b.holding.name, "en", { numeric: true, sensitivity: "base" });

export default function InvestmentsPage() {
  const [kindFilter, setKindFilter] = useState<"ALL" | InvestmentKind>("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("NAME");
  // One "now" for the whole page so every card's "in N days" agrees.
  const [now] = useState(() => new Date());
  const { data, isLoading } = useSWR<{ investments: HoldingListItem[] }>(
    "/api/investments",
    fetcher,
  );
  const { openDialog } = useTransactionDialog();

  const investments = useMemo(() => data?.investments ?? [], [data]);

  const { data: rateData } = useSWR<{ rate: number }>("/api/market/rate", fetcher);
  const usdInrRate = rateData?.rate ?? 84;

  // ── Live share prices ────────────────────────────────────────────────
  const stockSymbols = useMemo(() => {
    const s = new Set<string>();
    investments.forEach((i) => {
      if (i.kind === "STOCK" && i.symbol) s.add(i.symbol);
    });
    return [...s].sort();
  }, [investments]);
  const { data: quotes } = useSWR<StockQuote[]>(
    stockSymbols.length > 0 ? `/api/market/quote?symbols=${stockSymbols.join(",")}` : null,
    fetcher,
    { refreshInterval: 300_000 },
  );
  const quoteMap = useMemo(() => {
    const m = new Map<string, StockQuote>();
    if (Array.isArray(quotes)) quotes.forEach((q) => m.set(q.symbol, q));
    return m;
  }, [quotes]);

  // ── Latest fund NAVs ─────────────────────────────────────────────────
  const schemeCodes = useMemo(() => {
    const s = new Set<string>();
    investments.forEach((i) => {
      const code = isFundKind(i.kind) ? amfiSchemeCode(i.metadata) : null;
      if (code) s.add(code);
    });
    return [...s].sort();
  }, [investments]);
  const { data: navs, error: navError } = useSWR<MfNavResponse>(
    schemeCodes.length > 0 ? `/api/market/mf-nav?codes=${schemeCodes.join(",")}` : null,
    fetcher,
  );
  const navReady = schemeCodes.length === 0 || navs != null || navError != null;

  const rows: Row[] = useMemo(
    () =>
      investments.map((i) => {
        const quote = i.kind === "STOCK" && i.symbol ? quoteMap.get(i.symbol) : undefined;
        const code = isFundKind(i.kind) ? amfiSchemeCode(i.metadata) : null;
        return {
          holding: i,
          value: valueHolding(i, {
            now,
            usdInrRate,
            price: quote?.price ?? null,
            nav: code ? navs?.[code] : null,
          }),
          livePrice: quote?.price ?? 0,
          dayChangePct: quote?.changePercent ?? 0,
        };
      }),
    [investments, quoteMap, navs, usdInrRate, now],
  );

  const sorter = useMemo(() => {
    const cmp =
      sortKey === "VALUE"
        ? (a: Row, b: Row) => a.value.current - b.value.current || byName(a, b)
        : sortKey === "DATE"
          ? (a: Row, b: Row) => nextDate(a.holding) - nextDate(b.holding) || byName(a, b)
          : byName;
    // Closed holdings always sink to the bottom of their group.
    return (a: Row, b: Row) =>
      Number(b.holding.active) - Number(a.holding.active) || cmp(a, b);
  }, [sortKey]);

  const groups = useMemo(
    () =>
      GROUPS.map((g) => {
        const all = rows.filter((r) => r.holding.kind === g.kind).sort(sorter);
        const open = all.filter((r) => r.holding.active);
        const invested = open.reduce((s, r) => s + r.value.invested, 0);
        const current = open.reduce((s, r) => s + r.value.current, 0);
        return { ...g, rows: all, openCount: open.length, invested, current };
      }).filter((g) => g.rows.length > 0),
    [rows, sorter],
  );
  const shown = kindFilter === "ALL" ? groups : groups.filter((g) => g.kind === kindFilter);

  // Totals count open holdings only — a closed one is history, not money.
  const totalInvested = shown.reduce((s, g) => s + g.invested, 0);
  const totalCurrent = shown.reduce((s, g) => s + g.current, 0);
  const holdingCount = shown.reduce((s, g) => s + g.openCount, 0);
  const unrealised = totalCurrent - totalInvested;
  const unrealisedPct = totalInvested > 0 ? (unrealised / totalInvested) * 100 : 0;
  const updating =
    (stockSymbols.length > 0 && !quotes) || (schemeCodes.length > 0 && !navReady);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Investments</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Stocks, mutual funds, SIPs, deposits and insurance. {holdingCount} active
            holding{holdingCount === 1 ? "" : "s"}
            {totalInvested > 0 ? ` · ${formatINR(totalInvested)} invested` : ""}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/investments/stocks"
            className="inline-flex items-center gap-2 rounded-lg border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors"
          >
            <TrendingUp className="h-4 w-4" /> Stocks portfolio
          </Link>
          <Link
            href="/investments/gold"
            className="inline-flex items-center gap-2 rounded-lg border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors"
          >
            <Gem className="h-4 w-4" /> Gold &amp; jewellery
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
          sub={updating ? "Updating prices…" : undefined}
        />
        <Stat
          label="Unrealised"
          value={`${unrealised >= 0 ? "+" : "−"}${formatINR(Math.abs(unrealised))}`}
          sub={
            totalInvested > 0
              ? `${unrealised >= 0 ? "+" : "−"}${Math.abs(unrealisedPct).toFixed(2)}%`
              : undefined
          }
          tone={unrealised >= 0 ? "primary" : "destructive"}
        />
        <Stat label="Holdings" value={String(holdingCount)} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2 overflow-x-auto pb-1">
          <Button
            size="sm"
            variant={kindFilter === "ALL" ? "default" : "outline"}
            onClick={() => setKindFilter("ALL")}
          >
            All
          </Button>
          {GROUPS.map((g) =>
            // Gold has its own space: one row per ornament, not one card
            // per bill. The chip navigates there rather than filtering here.
            g.kind === "GOLD" ? (
              <Link
                key={g.kind}
                href="/investments/gold"
                className={buttonVariants({ size: "sm", variant: "outline" })}
              >
                Gold
              </Link>
            ) : (
              <Button
                key={g.kind}
                size="sm"
                variant={kindFilter === g.kind ? "default" : "outline"}
                onClick={() => setKindFilter(g.kind)}
              >
                {g.chip}
              </Button>
            ),
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Sort</span>
          <NativeSelect
            value={sortKey}
            onChange={(v) => setSortKey(v as SortKey)}
            options={SORT_OPTIONS}
            className="w-60"
          />
        </div>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {shown.map((g) => {
        const gain = g.current - g.invested;
        const Icon = g.icon;
        return (
          <section key={g.kind} className="space-y-3" aria-label={g.label}>
            <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 border-b pb-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Icon className="h-4 w-4 text-sky-600 dark:text-sky-400" />
                {g.label}
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {g.rows.length}
                </span>
              </h2>
              {g.openCount > 0 && (
                <div className="text-xs tabular-nums text-muted-foreground">
                  {g.kind === "INSURANCE" ? "Premiums paid" : "Invested"}{" "}
                  <span className="font-medium text-foreground">{formatINR(g.invested)}</span>
                  {g.kind !== "INSURANCE" && (
                    <>
                      {" · "}Now{" "}
                      <span className="font-medium text-foreground">{formatINR(g.current)}</span>
                      {Math.abs(gain) >= 0.5 && (
                        <span
                          className={cn(
                            "ml-1.5 font-medium",
                            gain >= 0
                              ? "text-emerald-700 dark:text-emerald-400"
                              : "text-red-700 dark:text-red-400",
                          )}
                        >
                          {gain >= 0 ? "+" : "−"}
                          {formatINR(Math.abs(gain))}
                          {g.invested > 0
                            ? ` (${gain >= 0 ? "+" : "−"}${Math.abs((gain / g.invested) * 100).toFixed(2)}%)`
                            : ""}
                        </span>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {g.rows.map((row) => {
                const code = isFundKind(row.holding.kind)
                  ? amfiSchemeCode(row.holding.metadata)
                  : null;
                return (
                  <HoldingCard
                    key={row.holding.id}
                    holding={row.holding}
                    value={row.value}
                    now={now}
                    nav={code ? navs?.[code] : null}
                    navReady={navReady}
                    livePrice={row.livePrice}
                    dayChangePct={row.dayChangePct}
                  />
                );
              })}
            </div>
          </section>
        );
      })}

      {shown.length === 0 && !isLoading && (
        <div className="rounded-xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
          {kindFilter === "ALL"
            ? "No investments yet. Add stocks, SIPs, FDs, or insurance to start tracking."
            : `No ${GROUPS.find((g) => g.kind === kindFilter)?.label.toLowerCase()} yet.`}
        </div>
      )}
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
