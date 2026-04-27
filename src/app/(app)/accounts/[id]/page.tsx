import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessRecord } from "@/lib/permissions";
import { computeAccountBalance } from "@/lib/account-balance";
import { formatINR, formatDate } from "@/lib/utils";
import {
  calendarMonthPeriods,
  parsePeriodId,
  rangeToPrismaFilter,
} from "@/lib/statement-period";
import { PeriodFilter } from "@/components/transactions/period-filter";
import {
  AccountFlowChart,
  type AccountFlowBucket,
} from "@/components/accounts/account-flow-chart";
import {
  CategoryBreakdown,
  type CategorySlice,
} from "@/components/cards/category-breakdown";

export default async function AccountDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const session = await auth();
  const account = await prisma.account.findUnique({
    where: { id },
    include: {
      ownerUser: { select: { name: true, email: true } },
      ownerContact: { select: { name: true } },
    },
  });
  if (!account || account.workspaceId !== session?.user.activeWorkspaceId) notFound();
  if (!canAccessRecord(session, account)) notFound();
  const balance = await computeAccountBalance(account.id);

  const periods = calendarMonthPeriods();
  let activeId = sp.period ?? periods[0]?.id ?? "";
  let activeRange: { start: Date; end: Date } | null = null;
  if (activeId === "custom") {
    if (sp.from && sp.to) {
      const start = new Date(`${sp.from}T00:00:00Z`);
      const end = new Date(`${sp.to}T00:00:00Z`);
      if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
        activeRange = { start, end };
      }
    }
  } else {
    const parsed = parsePeriodId(activeId);
    if (parsed) activeRange = parsed;
    else {
      activeId = periods[0]?.id ?? "";
      activeRange = periods[0] ? { start: periods[0].start, end: periods[0].end } : null;
    }
  }

  const transactions = activeRange
    ? await prisma.transaction.findMany({
        where: {
          accountId: account.id,
          workspaceId: account.workspaceId,
          date: rangeToPrismaFilter(activeRange),
        },
        orderBy: { date: "desc" },
        select: {
          id: true,
          type: true,
          amount: true,
          description: true,
          date: true,
          category: { select: { name: true } },
        },
      })
    : [];

  const periodIncome = transactions.reduce(
    (s, t) => s + (t.type === "INCOME" ? Number(t.amount) : 0),
    0,
  );
  const periodExpense = transactions.reduce(
    (s, t) => s + (t.type === "EXPENSE" ? Number(t.amount) : 0),
    0,
  );
  const periodNet = periodIncome - periodExpense;

  // ── Cash-flow trend over the last 6 months ────────────────────────────
  const trendPeriods = periods.slice(0, 6);
  const trendBuckets: AccountFlowBucket[] = [];
  if (trendPeriods.length > 0) {
    const earliest = trendPeriods[trendPeriods.length - 1].start;
    const latest = trendPeriods[0].end;
    const txInRange = await prisma.transaction.findMany({
      where: {
        accountId: account.id,
        workspaceId: account.workspaceId,
        date: rangeToPrismaFilter({ start: earliest, end: latest }),
      },
      select: { type: true, amount: true, date: true },
    });
    for (const p of trendPeriods.slice().reverse()) {
      const lt = new Date(p.end.getTime() + 86400000);
      let income = 0;
      let expense = 0;
      for (const t of txInRange) {
        if (t.date < p.start || t.date >= lt) continue;
        if (t.type === "INCOME") income += Number(t.amount);
        else if (t.type === "EXPENSE") expense += Number(t.amount);
      }
      trendBuckets.push({
        id: p.id,
        label: p.start.toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" }),
        rangeLabel: p.label,
        income,
        expense,
      });
    }
  }

  // ── Category breakdown of expenses for the active period ──────────────
  const categoryMap = new Map<string, number>();
  for (const t of transactions) {
    if (t.type !== "EXPENSE") continue;
    const name = t.category?.name ?? "Uncategorized";
    categoryMap.set(name, (categoryMap.get(name) ?? 0) + Number(t.amount));
  }
  const categorySlices: CategorySlice[] = Array.from(categoryMap.entries())
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount);

  const balanceTone =
    balance.balance > 0
      ? "text-primary"
      : balance.balance < 0
        ? "text-destructive"
        : "text-foreground";

  return (
    <div className="space-y-6">
      <div>
        <Link href="/accounts" className="text-xs text-muted-foreground">
          ← Accounts
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{account.name}</h1>
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          {account.kind}
          {account.ownerContact ? ` · ${account.ownerContact.name}` : ""}
        </p>
      </div>

      {/* Hero */}
      <section className="rounded-2xl border bg-linear-to-br from-card to-muted/40 p-5 sm:p-6">
        <div className="grid gap-6 md:grid-cols-[1.4fr_1fr]">
          <div className="flex flex-col justify-between gap-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Balance
              </div>
              <div className={`mt-1 text-4xl font-bold tabular-nums ${balanceTone}`}>
                {formatINR(balance.balance)}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                Opening {formatINR(balance.openingBalance)}
              </div>
            </div>
            {(periodIncome > 0 || periodExpense > 0) && (
              <div>
                <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
                  {(() => {
                    const total = periodIncome + periodExpense;
                    const incomePct = total > 0 ? (periodIncome / total) * 100 : 0;
                    const expensePct = total > 0 ? (periodExpense / total) * 100 : 0;
                    return (
                      <>
                        <div className="h-full bg-primary" style={{ width: `${incomePct}%` }} />
                        <div
                          className="h-full bg-destructive"
                          style={{ width: `${expensePct}%` }}
                        />
                      </>
                    );
                  })()}
                </div>
                <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground tabular-nums">
                  <span className="text-emerald-700 dark:text-emerald-400">
                    + {formatINR(periodIncome)}
                  </span>
                  <span className="text-destructive">− {formatINR(periodExpense)}</span>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3 sm:gap-4 md:grid-cols-1 md:grid-rows-3">
            <SubStat
              label="Period income"
              value={formatINR(periodIncome)}
              tone={periodIncome > 0 ? "gain" : "muted"}
            />
            <SubStat
              label="Period expense"
              value={formatINR(periodExpense)}
              tone={periodExpense > 0 ? "loss" : "muted"}
            />
            <SubStat
              label="Net"
              value={`${periodNet >= 0 ? "+" : "−"}${formatINR(Math.abs(periodNet))}`}
              tone={periodNet >= 0 ? "gain" : "loss"}
            />
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-lg border bg-card p-4 min-w-0">
          <div>
            <h3 className="text-sm font-semibold">Cash flow</h3>
            <p className="text-xs text-muted-foreground">Last {trendBuckets.length} months</p>
          </div>
          <div className="mt-3 min-w-0">
            <AccountFlowChart data={trendBuckets} />
          </div>
        </section>
        <section className="rounded-lg border bg-card p-4 min-w-0">
          <div>
            <h3 className="text-sm font-semibold">By category</h3>
            <p className="text-xs text-muted-foreground">
              Selected period · {formatINR(periodExpense)}
            </p>
          </div>
          <div className="mt-3 min-w-0">
            <CategoryBreakdown data={categorySlices} />
          </div>
        </section>
      </div>

      <section className="rounded-lg border bg-card">
        <header className="px-5 py-3 border-b flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold">Transactions</h2>
            {activeRange && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {transactions.length} txn{transactions.length === 1 ? "" : "s"} · in{" "}
                {formatINR(periodIncome)} · out {formatINR(periodExpense)}
              </p>
            )}
          </div>
          <PeriodFilter
            periods={periods}
            activeId={activeId}
            customFrom={sp.from}
            customTo={sp.to}
          />
        </header>
        {transactions.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">
            No transactions in this period.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b bg-muted/30">
                <th className="px-5 py-2">Date</th>
                <th className="px-5 py-2">Description</th>
                <th className="px-5 py-2">Category</th>
                <th className="px-5 py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((t) => {
                const isIncome = t.type === "INCOME";
                return (
                  <tr key={t.id} className="border-b last:border-0 hover:bg-muted/20">
                    <td className="px-5 py-2.5 text-muted-foreground whitespace-nowrap tabular-nums">
                      {formatDate(t.date)}
                    </td>
                    <td className="px-5 py-2.5">
                      <div className="font-medium truncate">{t.description}</div>
                    </td>
                    <td className="px-5 py-2.5">
                      {t.category?.name ? (
                        <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                          {t.category.name}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td
                      className={`px-5 py-2.5 text-right font-semibold tabular-nums ${
                        isIncome
                          ? "text-emerald-700 dark:text-emerald-400"
                          : "text-destructive"
                      }`}
                    >
                      {isIncome ? "+" : "−"}
                      {formatINR(Number(t.amount))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function SubStat({
  label,
  value,
  tone = "muted",
}: {
  label: string;
  value: string;
  tone?: "muted" | "gain" | "loss";
}) {
  const valueClass =
    tone === "gain"
      ? "text-primary"
      : tone === "loss"
        ? "text-destructive"
        : "";
  return (
    <div className="rounded-lg border bg-background/60 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${valueClass}`}>{value}</div>
    </div>
  );
}
