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
  Sprout,
  PawPrint,
  Wallet2,
  Users,
  HardHat,
  AlertCircle,
  CalendarClock,
  Hourglass,
  Wallet,
} from "lucide-react";
import { formatINR, formatDate } from "@/lib/utils";
import { calendarMonthPeriods } from "@/lib/statement-period";
import { PeriodFilter } from "@/components/transactions/period-filter";

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

type Summary = {
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
  currentMonthDue: number;
  nextMonthDue: number;
  activeCropBatches: number;
  activeLivestockBatches: number;
  pendingSettlements: number;
  dues: Due[];
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
  const { data } = useSWR<Summary>(
    `/api/dashboard/summary${queryString ? `?${queryString}` : ""}`,
    fetcher,
  );

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
          value={data ? formatINR(data.netWorth) : "—"}
          hint="Liquid + invested − debts"
          icon={<Wallet2 className="h-5 w-5" />}
          tone={data && data.netWorth >= 0 ? "primary" : "destructive"}
        />
        <BigStat
          label="Period flow"
          value={
            data
              ? `${data.period.net >= 0 ? "+" : "−"}${formatINR(Math.abs(data.period.net))}`
              : "—"
          }
          hint={
            data
              ? `+${formatINR(data.period.income)} / −${formatINR(data.period.expense)}`
              : ""
          }
          icon={
            data && data.period.net >= 0 ? (
              <ArrowDownLeft className="h-5 w-5 text-primary" />
            ) : (
              <ArrowUpRight className="h-5 w-5 text-destructive" />
            )
          }
        />
        <BigStat
          label="Liquid"
          value={data ? formatINR(data.liquid) : "—"}
          hint="Bank + cash + wallet"
          icon={<Landmark className="h-5 w-5" />}
        />
        <BigStat
          label="Invested"
          value={data ? formatINR(data.investedCurrent) : "—"}
          hint={data ? `${formatINR(data.investedAmount)} invested` : ""}
          icon={<ArrowDownLeft className="h-5 w-5" />}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[2fr_1fr]">
        <UpcomingDues dues={data?.dues ?? null} />

        <section className="space-y-3">
          <SmallCard
            title="Card outstanding"
            value={data ? formatINR(data.cardOutstanding) : "—"}
            icon={<CreditCard className="h-4 w-4" />}
            href="/cards"
          />
          <SmallCard
            title="Loan outstanding"
            value={data ? formatINR(data.loanOutstanding) : "—"}
            icon={<Landmark className="h-4 w-4" />}
            href="/loans/bank"
          />
          <SmallCard
            title="Due this month"
            value={data ? formatINR(data.currentMonthDue) : "—"}
            icon={<CalendarClock className="h-4 w-4" />}
          />
          <SmallCard
            title="Due next month"
            value={data ? formatINR(data.nextMonthDue) : "—"}
            icon={<Hourglass className="h-4 w-4" />}
          />
          <SmallCard
            title="Member charges"
            value={data ? formatINR(data.chargesOutstanding) : "—"}
            icon={<Users className="h-4 w-4" />}
            href="/contacts"
          />
          <SmallCard
            title="Active crop batches"
            value={data ? String(data.activeCropBatches) : "—"}
            icon={<Sprout className="h-4 w-4" />}
            href="/crops"
          />
          <SmallCard
            title="Active livestock batches"
            value={data ? String(data.activeLivestockBatches) : "—"}
            icon={<PawPrint className="h-4 w-4" />}
            href="/livestock"
          />
          <SmallCard
            title="Pending wage settlements"
            value={data ? String(data.pendingSettlements) : "—"}
            icon={<HardHat className="h-4 w-4" />}
            href="/wages"
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
      {showPay && due.payHref && (
        <Link
          href={due.payHref}
          aria-label={`Pay ${due.label}`}
          className="inline-flex items-center gap-1 rounded-md border bg-card px-2.5 py-1.5 text-[11px] font-medium text-primary hover:bg-primary hover:text-primary-foreground active:scale-95 transition-all shrink-0"
        >
          <Wallet className="h-3 w-3" /> Pay
        </Link>
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
  icon,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  icon: React.ReactNode;
  tone?: "default" | "primary" | "destructive";
}) {
  const color =
    tone === "primary"
      ? "text-primary"
      : tone === "destructive"
        ? "text-destructive"
        : "text-foreground";
  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        <div className="text-muted-foreground">{icon}</div>
      </div>
      <div className={`mt-2 text-2xl font-semibold ${color}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

function SmallCard({
  title,
  value,
  icon,
  href,
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
  href?: string;
}) {
  const inner = (
    <>
      <div className="h-10 w-10 rounded-lg bg-accent flex items-center justify-center text-primary">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-muted-foreground">{title}</div>
        <div className="text-lg font-semibold truncate">{value}</div>
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
