"use client";

import Link from "next/link";
import useSWR from "swr";
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
} from "lucide-react";
import { formatINR, formatDate } from "@/lib/utils";

type Summary = {
  month: { income: number; expense: number; net: number };
  netWorth: number;
  liquid: number;
  investedAmount: number;
  investedCurrent: number;
  cardOutstanding: number;
  loanOutstanding: number;
  chargesOutstanding: number;
  activeCropBatches: number;
  activeLivestockBatches: number;
  pendingSettlements: number;
  reminders: {
    id: string;
    kind: string;
    dueDate: string;
    amount: number | null;
    name: string;
  }[];
};

const fetcher = async (url: string) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
};

export default function DashboardPage() {
  const { data: session } = useSession();
  const { data } = useSWR<Summary>("/api/dashboard/summary", fetcher);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome back, {session?.user.name?.split(" ")[0] ?? "friend"}
        </h1>
        <p className="text-sm text-muted-foreground">
          Overview for this month across every feature.
        </p>
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
          label="This month"
          value={
            data
              ? `${data.month.net >= 0 ? "+" : "−"}${formatINR(Math.abs(data.month.net))}`
              : "—"
          }
          hint={
            data
              ? `+${formatINR(data.month.income)} / −${formatINR(data.month.expense)}`
              : ""
          }
          icon={
            data && data.month.net >= 0 ? (
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

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
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
          title="Member charges"
          value={data ? formatINR(data.chargesOutstanding) : "—"}
          icon={<Users className="h-4 w-4" />}
          href="/members"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[2fr_1fr]">
        <section className="rounded-xl border bg-card p-5">
          <h2 className="flex items-center gap-2 font-semibold mb-3">
            <Bell className="h-4 w-4 text-primary" /> Upcoming reminders
          </h2>
          <div className="divide-y">
            {(data?.reminders ?? []).map((r) => (
              <div key={r.id} className="flex items-center gap-3 py-2.5">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">
                    {r.kind.replace(/_/g, " ")} · {r.name}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatDate(r.dueDate)}
                    {r.amount != null ? ` · ${formatINR(r.amount)}` : ""}
                  </div>
                </div>
                <Link href="/reminders" className="text-xs text-primary hover:underline">
                  Open →
                </Link>
              </div>
            ))}
            {data && data.reminders.length === 0 && (
              <div className="py-4 text-sm text-muted-foreground text-center">
                Nothing in the next two weeks.
              </div>
            )}
          </div>
        </section>

        <section className="space-y-3">
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
  href: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-xl border bg-card p-4 hover:bg-accent/40 transition"
    >
      <div className="h-10 w-10 rounded-lg bg-accent flex items-center justify-center text-primary">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-muted-foreground">{title}</div>
        <div className="text-lg font-semibold truncate">{value}</div>
      </div>
    </Link>
  );
}
