"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { toast } from "sonner";
import {
  ArrowLeft,
  Archive,
  ArchiveRestore,
  CalendarDays,
  Pencil,
  PiggyBank,
  Receipt,
  Trash2,
  Users,
  Wallet,
} from "lucide-react";
import { useSession } from "next-auth/react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { AttachmentList } from "@/components/attachments/attachment-list";
import { EventDialog } from "@/components/events/event-dialog";
import { TransactionDetailDialog } from "@/components/transactions/transaction-detail-dialog";
import { hasPermission } from "@/lib/permissions";
import { formatINR, formatDate } from "@/lib/utils";
import { fetcher } from "@/lib/swr-fetcher";

type EventDetail = {
  event: {
    id: string;
    name: string;
    kind: "TRIP" | "FUNCTION" | "FESTIVAL" | "PROJECT" | "MEDICAL" | "OTHER";
    startedAt: string;
    endedAt: string | null;
    notes: string | null;
    budget: number | null;
    active: boolean;
  };
  totalSpent: number;
  breakdown: {
    categoryId: string | null;
    label: string;
    total: number;
  }[];
  memberSplits: {
    contactId: string;
    contactName: string;
    owes: number;
    settled: number;
  }[];
  transactions: {
    id: string;
    date: string;
    type: string;
    amount: number;
    description: string;
    categoryId: string | null;
    categoryLabel: string;
  }[];
};

const KIND_COLOUR: Record<EventDetail["event"]["kind"], string> = {
  TRIP: "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
  FUNCTION: "bg-pink-50 text-pink-700 dark:bg-pink-950/40 dark:text-pink-300",
  FESTIVAL: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  PROJECT: "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
  MEDICAL: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  OTHER: "bg-slate-50 text-slate-700 dark:bg-slate-950/40 dark:text-slate-300",
};

// Chart palette — kept inline (rather than CSS variables) so recharts
// renders consistently in both light/dark without theme plumbing.
const PIE_COLORS = [
  "#6366f1",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#06b6d4",
  "#8b5cf6",
  "#ec4899",
  "#84cc16",
  "#f97316",
  "#14b8a6",
];

export default function EventDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { data: session } = useSession();
  const canWrite = hasPermission(session, "events", "full");
  const detailKey = `/api/events/${id}`;
  const { data, isLoading } = useSWR<EventDetail>(detailKey, fetcher);
  const [editOpen, setEditOpen] = useState(false);
  const [focusTxnId, setFocusTxnId] = useState<string | null>(null);
  const [txQuery, setTxQuery] = useState("");
  const [txTypeFilter, setTxTypeFilter] = useState<"ALL" | "EXPENSE" | "INCOME">(
    "ALL",
  );

  // Daily spend series for the trend chart, computed from transactions.
  // Buckets by ISO date; includes only EXPENSE rows. The React compiler
  // memoizes these derived values automatically — no manual useMemo.
  const dailySeries = computeDailySeries(data?.transactions);
  const filteredTxns = filterTransactions(
    data?.transactions,
    txQuery,
    txTypeFilter,
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-24" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (!data?.event)
    return (
      <p className="text-sm text-muted-foreground">
        Event not found.{" "}
        <Link href="/events" className="underline">
          Back to events
        </Link>
      </p>
    );

  const { event, totalSpent, breakdown, memberSplits, transactions } = data;
  const dateLabel =
    event.endedAt && event.endedAt !== event.startedAt
      ? `${formatDate(event.startedAt)} – ${formatDate(event.endedAt)}`
      : formatDate(event.startedAt);
  const budgetRemaining =
    event.budget != null ? event.budget - totalSpent : null;
  const budgetPct =
    event.budget != null && event.budget > 0
      ? Math.min(100, Math.round((totalSpent / event.budget) * 100))
      : null;
  const contributorCount = memberSplits.length;
  const totalIncome = transactions
    .filter((t) => t.type === "INCOME")
    .reduce((sum, t) => sum + t.amount, 0);
  const averageDailySpend =
    dailySeries.length > 0
      ? totalSpent / dailySeries.length
      : 0;
  const largestExpense = transactions
    .filter((t) => t.type === "EXPENSE")
    .reduce(
      (max, t) => (t.amount > max.amount ? t : max),
      { amount: 0, description: "—" } as { amount: number; description: string },
    );

  async function archive(toggle: boolean) {
    const res = await fetch(`/api/events/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active: toggle }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(body.error ?? "Failed");
      return;
    }
    toast.success(toggle ? "Restored" : "Archived");
    globalMutate(detailKey);
    globalMutate((k) => typeof k === "string" && k.startsWith("/api/events"));
  }

  async function remove() {
    if (
      !confirm(
        "Delete this event? Linked transactions stay; only the event grouping is removed.",
      )
    )
      return;
    const res = await fetch(`/api/events/${id}`, { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(body.error ?? "Failed to delete");
      return;
    }
    toast.success("Event deleted");
    globalMutate((k) => typeof k === "string" && k.startsWith("/api/events"));
    router.push("/events");
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/events"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> All events
        </Link>
      </div>

      <header className="rounded-xl border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${KIND_COLOUR[event.kind]}`}
              >
                {event.kind}
              </span>
              {!event.active && (
                <Badge variant="secondary" className="text-[9px]">
                  Archived
                </Badge>
              )}
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <CalendarDays className="h-3 w-3" />
                {dateLabel}
              </span>
            </div>
            <h1 className="mt-1.5 text-2xl font-semibold tracking-tight">
              {event.name}
            </h1>
            {event.notes && (
              <p className="mt-2 max-w-2xl whitespace-pre-wrap text-sm text-muted-foreground">
                {event.notes}
              </p>
            )}
          </div>
          {canWrite && (
            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEditOpen(true)}
                className="gap-1"
              >
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => archive(!event.active)}
                className="gap-1"
              >
                {event.active ? (
                  <>
                    <Archive className="h-3.5 w-3.5" /> Archive
                  </>
                ) : (
                  <>
                    <ArchiveRestore className="h-3.5 w-3.5" /> Restore
                  </>
                )}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={remove}
                title="Delete event"
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          )}
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          icon={<Wallet className="h-3.5 w-3.5" />}
          label="Total expense"
          value={formatINR(totalSpent)}
        />
        <KpiCard
          icon={<PiggyBank className="h-3.5 w-3.5" />}
          label="Budget"
          value={event.budget != null ? formatINR(event.budget) : "—"}
          progress={budgetPct ?? undefined}
        />
        <KpiCard
          icon={<Receipt className="h-3.5 w-3.5" />}
          label={
            budgetRemaining != null && budgetRemaining < 0
              ? "Over budget"
              : "Remaining"
          }
          value={
            budgetRemaining != null
              ? formatINR(Math.abs(budgetRemaining))
              : "—"
          }
          tone={
            budgetRemaining != null && budgetRemaining < 0
              ? "negative"
              : "default"
          }
        />
        <KpiCard
          icon={<Users className="h-3.5 w-3.5" />}
          label="Transactions"
          value={String(transactions.length)}
          hint={
            contributorCount > 0
              ? `${contributorCount} contributor${contributorCount === 1 ? "" : "s"}`
              : undefined
          }
        />
      </section>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="flex w-full overflow-x-auto sm:w-fit sm:max-w-full">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="transactions">
            Transactions ({transactions.length})
          </TabsTrigger>
          <TabsTrigger value="splits">
            Splits ({memberSplits.length})
          </TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-xl border bg-card p-4 lg:col-span-2">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Spend over time</h2>
                <span className="text-[10px] text-muted-foreground">
                  Daily aggregate · expense only
                </span>
              </div>
              {dailySeries.length === 0 ? (
                <EmptyChart msg="No expense activity yet." />
              ) : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={dailySeries}
                      margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                      <XAxis
                        dataKey="label"
                        fontSize={10}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        fontSize={10}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v) =>
                          v >= 1000 ? `₹${Math.round(v / 1000)}k` : `₹${v}`
                        }
                      />
                      <Tooltip
                        formatter={(v) => formatINR(Number(v))}
                        labelStyle={{ fontSize: 11 }}
                        contentStyle={{ fontSize: 11, borderRadius: 6 }}
                      />
                      <Bar dataKey="spent" fill="#6366f1" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="rounded-xl border bg-card p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">By category</h2>
                <span className="text-[10px] text-muted-foreground">
                  {breakdown.length} bucket{breakdown.length === 1 ? "" : "s"}
                </span>
              </div>
              {breakdown.length === 0 ? (
                <EmptyChart msg="No category data yet." />
              ) : (
                <>
                  <div className="h-44">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={breakdown}
                          dataKey="total"
                          nameKey="label"
                          innerRadius={40}
                          outerRadius={70}
                          paddingAngle={2}
                        >
                          {breakdown.map((_, i) => (
                            <Cell
                              key={i}
                              fill={PIE_COLORS[i % PIE_COLORS.length]}
                            />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(v) => formatINR(Number(v))}
                          contentStyle={{ fontSize: 11, borderRadius: 6 }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <ul className="mt-2 space-y-1.5">
                    {breakdown.slice(0, 5).map((row, i) => {
                      const pct =
                        totalSpent > 0
                          ? Math.round((row.total / totalSpent) * 100)
                          : 0;
                      return (
                        <li
                          key={row.categoryId ?? "__none__"}
                          className="flex items-center justify-between gap-2 text-xs"
                        >
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span
                              className="h-2 w-2 shrink-0 rounded-sm"
                              style={{
                                backgroundColor:
                                  PIE_COLORS[i % PIE_COLORS.length],
                              }}
                            />
                            <span className="truncate">{row.label}</span>
                          </span>
                          <span className="shrink-0 tabular-nums text-muted-foreground">
                            {pct}%
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <MiniStat
              label="Income recorded"
              value={totalIncome > 0 ? formatINR(totalIncome) : "—"}
              hint="Refunds / contributions tagged to this event."
            />
            <MiniStat
              label="Avg / active day"
              value={
                averageDailySpend > 0 ? formatINR(averageDailySpend) : "—"
              }
              hint={
                dailySeries.length > 0
                  ? `Across ${dailySeries.length} day${dailySeries.length === 1 ? "" : "s"} of activity.`
                  : undefined
              }
            />
            <MiniStat
              label="Largest expense"
              value={
                largestExpense.amount > 0
                  ? formatINR(largestExpense.amount)
                  : "—"
              }
              hint={
                largestExpense.amount > 0
                  ? largestExpense.description
                  : undefined
              }
            />
          </div>
        </TabsContent>

        <TabsContent value="transactions" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-md border bg-card p-0.5 text-[11px]">
              {(["ALL", "EXPENSE", "INCOME"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setTxTypeFilter(k)}
                  className={`rounded px-2.5 py-1 transition-colors ${
                    txTypeFilter === k
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {k === "ALL" ? "All" : k === "EXPENSE" ? "Expense" : "Income"}
                </button>
              ))}
            </div>
            <input
              type="search"
              value={txQuery}
              onChange={(e) => setTxQuery(e.target.value)}
              placeholder="Search description or category…"
              className="h-8 flex-1 min-w-[180px] max-w-sm rounded-md border bg-card px-2.5 text-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/30"
            />
          </div>

          {filteredTxns.length === 0 ? (
            <Empty msg={
              transactions.length === 0
                ? "No transactions tagged yet. Tag a transaction to this event from the new-transaction dialog."
                : "No transactions match the current filter."
            } />
          ) : (
            <div className="overflow-x-auto rounded-xl border bg-card">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Date</th>
                    <th className="px-3 py-2 text-left font-medium">
                      Description
                    </th>
                    <th className="px-3 py-2 text-left font-medium">Category</th>
                    <th className="px-3 py-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredTxns.map((t) => (
                    <tr
                      key={t.id}
                      onClick={() => setFocusTxnId(t.id)}
                      className="cursor-pointer transition-colors hover:bg-muted/40"
                    >
                      <td className="px-3 py-2 text-xs tabular-nums text-muted-foreground">
                        {formatDate(t.date)}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <div className="truncate font-medium">
                          {t.description}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {t.categoryLabel}
                      </td>
                      <td
                        className={`px-3 py-2 text-right text-xs font-medium tabular-nums ${
                          t.type === "INCOME"
                            ? "text-emerald-700 dark:text-emerald-400"
                            : ""
                        }`}
                      >
                        {t.type === "INCOME" ? "+" : ""}
                        {formatINR(t.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="splits">
          {memberSplits.length === 0 ? (
            <Empty msg="No splits tracked. Mark a split as 'Recoverable' on a transaction to track who owes back." />
          ) : (
            <div className="overflow-x-auto rounded-xl border bg-card">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Contact</th>
                    <th className="px-3 py-2 text-right font-medium">
                      Outstanding
                    </th>
                    <th className="px-3 py-2 text-right font-medium">Settled</th>
                    <th className="px-3 py-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {memberSplits.map((s) => {
                    const total = s.owes + s.settled;
                    return (
                      <tr key={s.contactId} className="hover:bg-muted/40">
                        <td className="px-3 py-2">
                          <Link
                            href={`/contacts/${s.contactId}`}
                            className="text-xs font-medium hover:underline"
                          >
                            {s.contactName}
                          </Link>
                        </td>
                        <td
                          className={`px-3 py-2 text-right text-xs font-medium tabular-nums ${
                            s.owes > 0
                              ? "text-amber-700 dark:text-amber-400"
                              : "text-emerald-700 dark:text-emerald-400"
                          }`}
                        >
                          {s.owes > 0 ? formatINR(s.owes) : "settled"}
                        </td>
                        <td className="px-3 py-2 text-right text-xs tabular-nums text-muted-foreground">
                          {s.settled > 0 ? formatINR(s.settled) : "—"}
                        </td>
                        <td className="px-3 py-2 text-right text-xs tabular-nums">
                          {formatINR(total)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="documents">
          <AttachmentList
            ownerKind="EVENT_DOCUMENT"
            ownerId={id}
            emptyMessage="No documents yet. Upload itineraries, hotel confirmations, wedding invitations — anything event-level."
            accept="image/*,application/pdf"
          />
        </TabsContent>
      </Tabs>

      <EventDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        event={{
          id: event.id,
          name: event.name,
          kind: event.kind,
          startedAt: event.startedAt,
          endedAt: event.endedAt,
          notes: event.notes,
          budget: event.budget,
        }}
      />

      <TransactionDetailDialog
        transactionId={focusTxnId}
        open={!!focusTxnId}
        onOpenChange={(o) => !o && setFocusTxnId(null)}
        onDeleted={() => globalMutate(detailKey)}
      />
    </div>
  );
}

function computeDailySeries(
  transactions: EventDetail["transactions"] | undefined,
): { date: string; spent: number; label: string }[] {
  if (!transactions?.length) return [];
  const byDate = new Map<string, number>();
  for (const t of transactions) {
    if (t.type !== "EXPENSE") continue;
    const day = t.date.slice(0, 10);
    byDate.set(day, (byDate.get(day) ?? 0) + t.amount);
  }
  return [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, spent]) => ({
      date,
      spent,
      label: new Date(date).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
      }),
    }));
}

function filterTransactions(
  transactions: EventDetail["transactions"] | undefined,
  query: string,
  typeFilter: "ALL" | "EXPENSE" | "INCOME",
): EventDetail["transactions"] {
  if (!transactions) return [];
  const q = query.trim().toLowerCase();
  return transactions.filter((t) => {
    if (typeFilter !== "ALL" && t.type !== typeFilter) return false;
    if (!q) return true;
    return (
      t.description.toLowerCase().includes(q) ||
      t.categoryLabel.toLowerCase().includes(q)
    );
  });
}

function KpiCard({
  icon,
  label,
  value,
  hint,
  tone = "default",
  progress,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "negative";
  progress?: number;
}) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div
        className={`mt-1 text-base font-semibold tabular-nums ${
          tone === "negative" ? "text-destructive" : ""
        }`}
      >
        {value}
      </div>
      {typeof progress === "number" && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full ${progress >= 100 ? "bg-destructive" : "bg-primary"}`}
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
      {hint && (
        <div className="mt-0.5 text-[10px] text-muted-foreground">{hint}</div>
      )}
    </div>
  );
}

function MiniStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border bg-card px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums">{value}</div>
      {hint && (
        <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
          {hint}
        </div>
      )}
    </div>
  );
}

function EmptyChart({ msg }: { msg: string }) {
  return (
    <div className="flex h-44 items-center justify-center rounded-lg bg-muted/40 text-xs text-muted-foreground">
      {msg}
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return (
    <div className="rounded-xl border bg-card p-4 text-xs text-muted-foreground">
      {msg}
    </div>
  );
}
