"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { useMemo } from "react";
import { useSession } from "next-auth/react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  CreditCard,
  Landmark,
  Wallet2,
  Users,
  HardHat,
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  Hourglass,
  Wallet,
} from "lucide-react";
import { formatINR, formatDate } from "@/lib/utils";
import { calendarMonthPeriods } from "@/lib/statement-period";
import { PeriodFilter } from "@/components/transactions/period-filter";
import type { StockQuote } from "@/app/api/market/quote/route";

type Due = {
  id: string;
  source: "REMINDER" | "LOAN" | "LEASE" | "CARD_STATEMENT";
  kind: string;
  label: string;
  dueDate: string;
  amount: number | null;
  total?: number;
  paid?: number;
  href: string;
  payHref?: string;
};

type Settled = {
  id: string;
  source: "REMINDER" | "LOAN" | "LEASE" | "CARD_STATEMENT";
  kind: string;
  label: string;
  amount: number;
  paidAt: string;
  href: string;
};

type Stats = {
  period: {
    start: string;
    end: string;
    income: number;
    expense: number;
    net: number;
  };
  netWorth: number;
  liquid: number;
  investedAmount: number;
  investedCurrent: number;
  cardOutstanding: number;
  loanOutstanding: number;
  chargesOutstanding: number;
};

type Cashflow = {
  dues: Due[];
  settled: Settled[];
  currentMonthDueGross: number;
  currentMonthDuePaid: number;
  currentMonthDueRemaining: number;
  currentMonthNonCardDueRemaining: number;
  nextMonthDue: number;
};

type StockLite = {
  id: string;
  symbol: string | null;
  quantity: number | null;
  amount: number;
  currency: string | null;
  active: boolean;
};

const fetcher = async (url: string) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
};

export default function DashboardPage() {
  const { data: session } = useSession();
  const search = useSearchParams();
  const periods = useMemo(() => calendarMonthPeriods(), []);
  const activeId = search.get("period") ?? periods[0]?.id ?? "";
  const queryString = search.toString();

  // Two parallel SWRs so each section loads independently. Stats is a
  // fast balance-sheet snapshot (top tiles + outstanding side cards);
  // cashflow is heavier (upcoming dues + settled list + monthly totals).
  const { data: stats } = useSWR<Stats>(
    `/api/dashboard/stats${queryString ? `?${queryString}` : ""}`,
    fetcher,
  );
  const { data: cashflow } = useSWR<Cashflow>(
    "/api/dashboard/cashflow",
    fetcher,
  );

  // Live stock marking — overrides stats.investedCurrent for stocks so
  // the Invested tile reflects today's market price + USD/INR rate
  // instead of cost basis. Same pattern as the dedicated /investments
  // page.
  const { data: stocksData } = useSWR<{ investments: StockLite[] }>(
    "/api/investments?kind=STOCK",
    fetcher,
  );
  const { data: rateData } = useSWR<{ rate: number }>(
    "/api/market/rate",
    fetcher,
  );
  const stocks = (stocksData?.investments ?? []).filter((s) => s.active);
  const usdInrRate = rateData?.rate ?? 84;
  const stockSymbols = useMemo(() => {
    const set = new Set<string>();
    stocks.forEach((s) => s.symbol && set.add(s.symbol));
    return [...set];
  }, [stocks]);
  const quotesKey =
    stockSymbols.length > 0
      ? `/api/market/quote?symbols=${stockSymbols.join(",")}`
      : null;
  const { data: quotes } = useSWR<StockQuote[]>(quotesKey, fetcher, {
    refreshInterval: 300_000,
  });
  const quoteMap = useMemo(() => {
    const m = new Map<string, StockQuote>();
    if (Array.isArray(quotes)) quotes.forEach((q) => m.set(q.symbol, q));
    return m;
  }, [quotes]);

  // Cumulative live gain across stocks (live value − cost basis).
  // Adding this to stats.investedCurrent flips the stocks portion from
  // cost to live, leaving non-stock investments untouched.
  const stockLiveGain = useMemo(() => {
    let total = 0;
    for (const h of stocks) {
      const qty = h.quantity ?? 0;
      const cost = Number(h.amount);
      if (qty <= 0 || !h.symbol) continue;
      const quote = quoteMap.get(h.symbol);
      const live = quote?.price ?? 0;
      if (live <= 0) continue;
      const liveRate = h.currency === "USD" ? usdInrRate : 1;
      total += qty * live * liveRate - cost;
    }
    return total;
  }, [stocks, quoteMap, usdInrRate]);

  const investedCurrentLive =
    stats != null ? stats.investedCurrent + stockLiveGain : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Welcome back, {session?.user.name?.split(" ")[0] ?? "friend"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Overview across every feature.
          </p>
        </div>
        <PeriodFilter
          periods={periods}
          activeId={activeId}
          customFrom={search.get("from") ?? undefined}
          customTo={search.get("to") ?? undefined}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <BigStat
          label="Net worth"
          value={stats ? formatINR(stats.netWorth) : "—"}
          hint="Liquid + invested − debts"
          icon={<Wallet2 className="h-5 w-5" />}
          tone={stats && stats.netWorth >= 0 ? "primary" : "destructive"}
        />
        <BigStat
          label="Period flow"
          value={
            stats
              ? `${stats.period.net >= 0 ? "+" : "−"}${formatINR(Math.abs(stats.period.net))}`
              : "—"
          }
          hint={
            stats
              ? `+${formatINR(stats.period.income)} / −${formatINR(stats.period.expense)}`
              : ""
          }
          icon={
            stats && stats.period.net >= 0 ? (
              <ArrowDownLeft className="h-5 w-5 text-primary" />
            ) : (
              <ArrowUpRight className="h-5 w-5 text-destructive" />
            )
          }
        />
        <BigStat
          label="Liquid"
          value={stats ? formatINR(stats.liquid) : "—"}
          change={
            stats &&
            cashflow &&
            (stats.cardOutstanding > 0 ||
              cashflow.currentMonthNonCardDueRemaining > 0)
              ? (() => {
                  const net =
                    stats.liquid -
                    stats.cardOutstanding -
                    cashflow.currentMonthNonCardDueRemaining;
                  const sign = net < 0 ? "−" : "";
                  return {
                    value: `${sign}${formatINR(Math.abs(net))} after card + this month's dues`,
                    tone: net >= 0 ? "gain" : "loss",
                  } as const;
                })()
              : undefined
          }
          hint="Bank + cash + wallet"
          icon={<Landmark className="h-5 w-5" />}
        />
        <BigStat
          label="Invested"
          value={
            investedCurrentLive != null
              ? formatINR(investedCurrentLive)
              : "—"
          }
          change={
            stats && stats.investedAmount > 0 && investedCurrentLive != null
              ? (() => {
                  const gain = investedCurrentLive - stats.investedAmount;
                  const pct = (gain / stats.investedAmount) * 100;
                  const sign = gain >= 0 ? "+" : "−";
                  return {
                    value: `${sign}${formatINR(Math.abs(gain))} · ${gain >= 0 ? "+" : ""}${pct.toFixed(2)}%`,
                    tone:
                      gain > 0 ? "gain" : gain < 0 ? "loss" : "neutral",
                  } as const;
                })()
              : undefined
          }
          hint={stats ? `Cost ${formatINR(stats.investedAmount)}` : ""}
          icon={<ArrowDownLeft className="h-5 w-5" />}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          <UpcomingDues dues={cashflow?.dues ?? null} />
          <SettledThisMonth settled={cashflow?.settled ?? null} />
        </div>

        <section className="space-y-3">
          <SmallCard
            title="Card outstanding"
            value={stats ? formatINR(stats.cardOutstanding) : "—"}
            icon={<CreditCard className="h-4 w-4" />}
            href="/cards"
          />
          <SmallCard
            title="Loan outstanding"
            value={stats ? formatINR(stats.loanOutstanding) : "—"}
            icon={<Landmark className="h-4 w-4" />}
            href="/loans/bank"
          />
          <SmallCard
            title="Due this month"
            value={cashflow ? formatINR(cashflow.currentMonthDueGross) : "—"}
            hint="Total scheduled — doesn't drop as you pay"
            icon={<CalendarClock className="h-4 w-4" />}
          />
          <SmallCard
            title="Paid this month"
            value={cashflow ? formatINR(cashflow.currentMonthDuePaid) : "—"}
            hint="Against this month's dues"
            icon={<CheckCircle2 className="h-4 w-4" />}
          />
          <SmallCard
            title="Due remaining"
            value={
              cashflow ? formatINR(cashflow.currentMonthDueRemaining) : "—"
            }
            hint="Still owed this month"
            icon={<Hourglass className="h-4 w-4" />}
          />
          {cashflow && cashflow.nextMonthDue > 0 && (
            <SmallCard
              title="Due next month"
              value={formatINR(cashflow.nextMonthDue)}
              icon={<CalendarClock className="h-4 w-4" />}
            />
          )}
          <SmallCard
            title="Member charges"
            value={stats ? formatINR(stats.chargesOutstanding) : "—"}
            icon={<Users className="h-4 w-4" />}
            href="/contacts"
          />
        </section>
      </div>
    </div>
  );
}

function UpcomingDues({ dues }: { dues: Due[] | null }) {
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  // Bucket dues by tone — overdue / due-soon / upcoming.
  const grouped = useMemo(() => {
    const overdue: Due[] = [];
    const soon: Due[] = [];
    const later: Due[] = [];
    for (const d of dues ?? []) {
      const due = new Date(d.dueDate);
      const days = Math.round((due.getTime() - today.getTime()) / 86400000);
      if (days < 0) overdue.push(d);
      else if (days <= 7) soon.push(d);
      else later.push(d);
    }
    return { overdue, soon, later };
  }, [dues, today]);

  const totalOwed = useMemo(
    () => (dues ?? []).reduce((s, d) => s + (d.amount ?? 0), 0),
    [dues],
  );

  return (
    <section className="rounded-xl border bg-card p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <Bell className="h-4 w-4 text-primary" /> Upcoming dues
        </h2>
        {dues && dues.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {dues.length} item{dues.length === 1 ? "" : "s"}
            {totalOwed > 0 ? ` · ${formatINR(totalOwed)} total` : ""}
          </p>
        )}
      </div>

      {!dues ? (
        <div className="py-6 text-sm text-muted-foreground text-center">Loading…</div>
      ) : dues.length === 0 ? (
        <div className="py-6 text-sm text-muted-foreground text-center">
          Nothing due in the next 30 days.
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.overdue.length > 0 && (
            <DueGroup
              label="Overdue"
              tone="overdue"
              dues={grouped.overdue}
              today={today}
            />
          )}
          {grouped.soon.length > 0 && (
            <DueGroup
              label="Due this week"
              tone="soon"
              dues={grouped.soon}
              today={today}
            />
          )}
          {grouped.later.length > 0 && (
            <DueGroup
              label="Coming up"
              tone="later"
              dues={grouped.later}
              today={today}
            />
          )}
        </div>
      )}
    </section>
  );
}

function SettledThisMonth({ settled }: { settled: Settled[] | null }) {
  // Hide entirely while loading or when there's nothing to show — keeps
  // the dashboard quiet for fresh accounts.
  if (settled === null) return null;
  if (settled.length === 0) return null;

  const totalPaid = settled.reduce((s, x) => s + x.amount, 0);

  return (
    <section className="rounded-xl border bg-card p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />{" "}
          Settled this month
        </h2>
        <p className="text-xs text-muted-foreground">
          {settled.length} item{settled.length === 1 ? "" : "s"}
          {totalPaid > 0 ? ` · ${formatINR(totalPaid)} paid` : ""}
        </p>
      </div>
      <div className="divide-y">
        {settled.map((s) => (
          <SettledRow key={s.id} item={s} />
        ))}
      </div>
    </section>
  );
}

function SettledRow({ item }: { item: Settled }) {
  return (
    <Link
      href={item.href}
      aria-label={`Open ${item.label}`}
      className="group flex items-center gap-3 py-2.5 -mx-2 px-2 rounded hover:bg-accent/30 transition focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-1"
    >
      <div className="h-8 w-8 shrink-0 rounded-lg bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 flex items-center justify-center">
        <CheckCircle2 className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{item.label}</div>
        <div className="text-[11px] text-muted-foreground tabular-nums">
          {item.kind.replace(/_/g, " ")} · paid {formatDate(new Date(item.paidAt))}
        </div>
      </div>
      <div className="text-sm font-semibold tabular-nums text-emerald-700 dark:text-emerald-400 shrink-0">
        {formatINR(item.amount)}
      </div>
    </Link>
  );
}

function DueGroup({
  label,
  tone,
  dues,
  today,
}: {
  label: string;
  tone: "overdue" | "soon" | "later";
  dues: Due[];
  today: Date;
}) {
  const dotClass =
    tone === "overdue"
      ? "bg-destructive"
      : tone === "soon"
        ? "bg-amber-500"
        : "bg-muted-foreground/40";
  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
        <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
      </div>
      <div className="divide-y">
        {dues.map((d) => (
          <DueRow key={d.id} due={d} today={today} />
        ))}
      </div>
    </div>
  );
}

function DueRow({ due, today }: { due: Due; today: Date }) {
  const dueDate = new Date(due.dueDate);
  const days = Math.round((dueDate.getTime() - today.getTime()) / 86400000);
  const dayLabel =
    days < 0
      ? `${Math.abs(days)}d overdue`
      : days === 0
        ? "Due today"
        : days === 1
          ? "Tomorrow"
          : `In ${days}d`;
  const dayClass =
    days < 0
      ? "text-destructive"
      : days <= 3
        ? "text-amber-600 dark:text-amber-400"
        : "text-muted-foreground";
  // Any due that exposes a payHref gets a Pay shortcut. payHref deep-links
  // into the relevant detail page with the right query param so the Pay/
  // Confirm dialog auto-opens on arrival.
  const showPay = due.payHref != null && (due.amount ?? 0) > 0;
  // Settled this cycle: row carries a total + paid that fully covers it,
  // and there's nothing left outstanding. Replaces the Pay button with
  // a confirmation tick so the user sees the EMI / bill is squared away.
  const isPaid =
    (due.amount ?? 0) === 0 &&
    due.total != null &&
    due.paid != null &&
    due.paid >= due.total;
  return (
    <div className="group flex items-center gap-2 py-2.5 -mx-2 px-2 rounded hover:bg-accent/30 transition">
      <Link
        href={due.href}
        aria-label={`Open ${due.label}`}
        className="flex flex-1 items-center gap-3 min-w-0 rounded focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-1"
      >
        <DueIcon source={due.source} overdue={days < 0} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{due.label}</div>
          <div className="text-[11px] text-muted-foreground tabular-nums">
            {due.kind.replace(/_/g, " ")} · {formatDate(dueDate)}
            {due.total != null && due.paid != null && due.paid > 0 && (
              <>
                {" · "}
                <span className="text-emerald-700 dark:text-emerald-400">
                  {formatINR(due.paid)} paid
                </span>{" "}
                of {formatINR(due.total)}
              </>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          {due.amount != null && (
            <div className="text-sm font-semibold tabular-nums">
              {formatINR(due.amount)}
            </div>
          )}
          <div className={`text-[10px] tabular-nums ${dayClass}`}>{dayLabel}</div>
        </div>
      </Link>
      {isPaid ? (
        <span
          aria-label="Paid"
          className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-50 dark:bg-emerald-900/30 px-2.5 py-1.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300 shrink-0"
        >
          <CheckCircle2 className="h-3 w-3" /> Paid
        </span>
      ) : (
        showPay &&
        due.payHref && (
          <Link
            href={due.payHref}
            aria-label={`Pay ${due.label}`}
            className="inline-flex items-center gap-1 rounded-md border bg-card px-2.5 py-1.5 text-[11px] font-medium text-primary hover:bg-primary hover:text-primary-foreground active:scale-95 transition-all shrink-0"
          >
            <Wallet className="h-3 w-3" /> Pay
          </Link>
        )
      )}
    </div>
  );
}

function DueIcon({ source, overdue }: { source: Due["source"]; overdue: boolean }) {
  if (overdue) {
    return (
      <div className="h-8 w-8 shrink-0 rounded-lg bg-destructive/10 text-destructive flex items-center justify-center">
        <AlertCircle className="h-4 w-4" />
      </div>
    );
  }
  const Icon =
    source === "LOAN" ? Landmark : source === "LEASE" ? HardHat : Bell;
  return (
    <div className="h-8 w-8 shrink-0 rounded-lg bg-accent text-primary flex items-center justify-center">
      <Icon className="h-4 w-4" />
    </div>
  );
}

function BigStat({
  label,
  value,
  hint,
  change,
  icon,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  /** Optional gain/loss sub-line (e.g. "+₹500 · +1.56%"). Tone colours the
   *  text but doesn't recolour the main value. */
  change?: { value: string; tone: "gain" | "loss" | "neutral" };
  icon: React.ReactNode;
  tone?: "default" | "primary" | "destructive";
}) {
  const color =
    tone === "primary"
      ? "text-primary"
      : tone === "destructive"
        ? "text-destructive"
        : "text-foreground";
  const changeColor =
    change?.tone === "gain"
      ? "text-emerald-700 dark:text-emerald-400"
      : change?.tone === "loss"
        ? "text-destructive"
        : "text-muted-foreground";
  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        <div className="text-muted-foreground">{icon}</div>
      </div>
      <div className={`mt-2 text-2xl font-semibold ${color}`}>{value}</div>
      {change && (
        <div className={`mt-1 text-xs font-medium tabular-nums ${changeColor}`}>
          {change.value}
        </div>
      )}
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

function SmallCard({
  title,
  value,
  icon,
  href,
  hint,
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
  href?: string;
  hint?: string;
}) {
  const inner = (
    <>
      <div className="h-10 w-10 rounded-lg bg-accent flex items-center justify-center text-primary">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-muted-foreground">{title}</div>
        <div className="text-lg font-semibold truncate">{value}</div>
        {hint && (
          <div className="text-[10px] text-muted-foreground truncate">{hint}</div>
        )}
      </div>
    </>
  );
  if (!href) {
    return (
      <div className="flex items-center gap-3 rounded-xl border bg-card p-4">
        {inner}
      </div>
    );
  }
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-xl border bg-card p-4 hover:bg-accent/40 transition"
    >
      {inner}
    </Link>
  );
}
