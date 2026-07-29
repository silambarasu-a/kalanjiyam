"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useSession } from "next-auth/react";
import {
  BarChart3,
  Sprout,
  PawPrint,
  Users,
  TrendingUp,
  Wallet,
  CreditCard,
  Landmark,
  LineChart,
  HardHat,
  ArrowUpRight,
  Receipt,
} from "lucide-react";
import { getPermission, isFarmFeature, type Feature } from "@/lib/permissions";

type ReportCard = {
  href: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Feature this report reads. Cards without one are ungated — they draw
   * on data every workspace has (money, contacts). */
  feature?: Feature;
};

type ReportGroup = {
  label: string;
  /** Label to fall back to once every farm card in the group is hidden, so
   * a farm-off workspace doesn't read "Farm & People" over a lone contact
   * report. */
  labelWithoutFarm?: string;
  reports: ReportCard[];
};

const GROUPS: ReportGroup[] = [
  {
    label: "Money",
    reports: [
      {
        href: "/reports/cashflow",
        title: "Cashflow",
        description:
          "Monthly income vs expense over time, with top categories and net trend.",
        icon: BarChart3,
      },
      {
        href: "/reports/pnl",
        title: "Profit & Loss",
        description:
          "Income and expense by category, with prior-period comparison.",
        icon: Receipt,
      },
      {
        href: "/reports/balances",
        title: "Account balances",
        description:
          "Snapshot of every bank, cash, wallet, and card account at a chosen date.",
        icon: Wallet,
      },
      {
        href: "/reports/net-worth",
        title: "Net worth trend",
        description:
          "Assets minus liabilities tracked monthly. Where your wealth stands today, and where it's going.",
        icon: TrendingUp,
      },
    ],
  },
  {
    label: "Credit & Investments",
    reports: [
      {
        href: "/reports/loans",
        title: "Loan portfolio",
        description:
          "Every active and closed loan: outstanding, EMI, interest paid, due dates.",
        icon: Landmark,
      },
      {
        href: "/reports/investments",
        title: "Investment portfolio",
        description:
          "Holdings, cost basis, current value, unrealised P&L, and dividends.",
        icon: LineChart,
      },
      {
        href: "/reports/cards",
        title: "Card spend",
        description:
          "Per-card spend, statements summary, and outstanding owed.",
        icon: CreditCard,
      },
    ],
  },
  {
    label: "Farm & People",
    labelWithoutFarm: "People",
    reports: [
      {
        href: "/reports/crops",
        title: "Crops P&L",
        description:
          "Per-crop and per-batch revenue, cost, and net contribution.",
        icon: Sprout,
        feature: "crops",
      },
      {
        href: "/reports/livestock",
        title: "Livestock P&L",
        description: "Per-batch margin, current head, and lifetime cost.",
        icon: PawPrint,
        feature: "livestock",
      },
      {
        href: "/reports/wages",
        title: "Wages & settlements",
        description:
          "Per-worker days worked, earned, paid, advances outstanding, and bonuses.",
        icon: HardHat,
        feature: "wages",
      },
      {
        // Contact ledger, not a farm report — stays put with the farm off.
        href: "/reports/members",
        title: "Member ledger",
        description: "Outstanding balances per contact across charges and transfers.",
        icon: Users,
      },
    ],
  },
];

export default function ReportsCatalogPage() {
  const { data: session } = useSession();

  // Drop cards the session can't see (farm module off, or a Member without
  // the feature) and collapse any group left empty. Relabel a group once
  // its farm cards are gone rather than dropping it — "Farm & People" also
  // carries the contact ledger, which survives with the farm off.
  const groups = useMemo(
    () =>
      GROUPS.map((g) => {
        const reports = g.reports.filter((r) =>
          r.feature && session
            ? getPermission(session, r.feature) !== "hidden"
            : true,
        );
        const stillFarm = reports.some(
          (r) => r.feature && isFarmFeature(r.feature),
        );
        return {
          ...g,
          label: stillFarm ? g.label : (g.labelWithoutFarm ?? g.label),
          reports,
        };
      }).filter((g) => g.reports.length > 0),
    [session],
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" /> Reports
        </h1>
        <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
          Pick a report to drill into. Every report supports date filtering,
          column sorting, and CSV / Excel / PDF export.
        </p>
      </div>

      {groups.map((g) => (
        <section key={g.label}>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            {g.label}
          </h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {g.reports.map((r) => {
              const Icon = r.icon;
              return (
                <Link
                  key={r.href}
                  href={r.href}
                  className="group rounded-xl border bg-card p-5 transition-colors hover:border-primary/40 hover:bg-accent/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <div className="rounded-lg bg-primary/10 p-2 text-primary">
                        <Icon className="h-4 w-4" />
                      </div>
                      <h3 className="font-semibold">{r.title}</h3>
                    </div>
                    <ArrowUpRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground line-clamp-3">
                    {r.description}
                  </p>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
