"use client";

import { use, useMemo, useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import Link from "next/link";
import {
  ArrowLeft,
  CreditCard,
  Pencil,
  Play,
  Repeat,
  SkipForward,
  Trash2,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatINR } from "@/lib/utils";
import { SubscriptionForm } from "@/components/subscriptions/subscription-form";
import { PaySubscriptionDialog } from "@/components/subscriptions/pay-subscription-dialog";
import { TransactionDetailDialog } from "@/components/transactions/transaction-detail-dialog";
import { fetcher } from "@/lib/swr-fetcher";

type Schedule = {
  id: string;
  dueDate: string;
  amount: number;
  status: "UPCOMING" | "CONFIRMED" | "SKIPPED" | "MISSED";
  skippedReason: string | null;
  confirmedTxn: { id: string; amount: number; date: string } | null;
};

type Subscription = {
  id: string;
  name: string;
  amount: number;
  cycle: "WEEKLY" | "MONTHLY" | "QUARTERLY" | "HALF_YEARLY" | "YEARLY";
  status: "ACTIVE" | "PAUSED" | "CANCELLED";
  nextBillingDate: string;
  startedOn: string;
  endsOn: string | null;
  autoPay: boolean;
  notes: string | null;
  account: { id: string; name: string; kind: string } | null;
  card: { id: string; name: string } | null;
  category: { id: string; name: string } | null;
  schedules: Schedule[];
};


export default function SubscriptionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data, isLoading, error } = useSWR<{ subscription: Subscription }>(
    `/api/subscriptions/${id}`,
    fetcher,
  );
  const [payOpen, setPayOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [focusTxnId, setFocusTxnId] = useState<string | null>(null);

  const sub = data?.subscription;

  const chart = useMemo(() => {
    if (!sub) return [];
    // Build last-12-month buckets from CONFIRMED schedules.
    const months: { month: string; total: number }[] = [];
    const cursor = new Date();
    cursor.setDate(1);
    cursor.setHours(0, 0, 0, 0);
    for (let i = 11; i >= 0; i--) {
      const ref = new Date(cursor);
      ref.setMonth(ref.getMonth() - i);
      months.push({
        month: ref.toLocaleDateString("en-IN", { month: "short" }),
        total: 0,
      });
    }
    for (const s of sub.schedules) {
      if (s.status !== "CONFIRMED" || !s.confirmedTxn) continue;
      const d = new Date(s.confirmedTxn.date);
      const monthsBack =
        (cursor.getFullYear() - d.getFullYear()) * 12 +
        (cursor.getMonth() - d.getMonth());
      const idx = 11 - monthsBack;
      if (idx >= 0 && idx < months.length) {
        months[idx].total += s.confirmedTxn.amount;
      }
    }
    return months;
  }, [sub]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (error || !sub) {
    return <p className="text-sm text-destructive">Subscription not found.</p>;
  }

  const totalPaid = sub.schedules
    .filter((s) => s.status === "CONFIRMED" && s.confirmedTxn)
    .reduce((sum, s) => sum + (s.confirmedTxn?.amount ?? 0), 0);
  const cyclesPaid = sub.schedules.filter((s) => s.status === "CONFIRMED").length;

  async function handleSkip() {
    if (!confirm("Skip the current cycle and roll forward to the next?")) return;
    const res = await fetch(`/api/subscriptions/${id}/skip`, { method: "POST" });
    if (res.ok) globalMutate(`/api/subscriptions/${id}`);
  }

  async function handleDelete(mode: "hard" | "soft") {
    const url =
      mode === "hard"
        ? `/api/subscriptions/${id}?hard=1`
        : `/api/subscriptions/${id}`;
    const res = await fetch(url, { method: "DELETE" });
    if (res.ok) {
      window.location.href = "/subscriptions";
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/subscriptions"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> Back to subscriptions
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <header className="rounded-lg border bg-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="flex items-center gap-2 text-xl font-semibold">
                  <Repeat className="h-5 w-5 text-muted-foreground" />
                  {sub.name}
                </h1>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{cycleLabel(sub.cycle)}</span>
                  <span>·</span>
                  <span className="font-medium tabular-nums text-foreground">
                    {formatINR(sub.amount)}
                  </span>
                  {sub.autoPay && (
                    <Badge variant="secondary" className="text-[9px]">
                      Auto-pay
                    </Badge>
                  )}
                  <StatusBadge status={sub.status} />
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                  <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDeleteOpen(true)}
                  className="text-destructive"
                >
                  <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
                </Button>
              </div>
            </div>
          </header>

          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="payments">Payments</TabsTrigger>
              <TabsTrigger value="schedule">Schedule</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-4 pt-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <KpiCard label="Total paid" value={formatINR(totalPaid)} />
                <KpiCard label="Cycles paid" value={cyclesPaid.toString()} />
                <KpiCard
                  label="Avg/cycle"
                  value={cyclesPaid ? formatINR(totalPaid / cyclesPaid) : "—"}
                />
                <KpiCard
                  label="Next billing"
                  value={new Date(sub.nextBillingDate).toLocaleDateString("en-IN", {
                    day: "2-digit",
                    month: "short",
                  })}
                />
              </div>

              <div className="rounded-lg border bg-card p-4">
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Last 12 months
                </div>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chart}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                      <XAxis dataKey="month" fontSize={11} />
                      <YAxis
                        fontSize={11}
                        tickFormatter={(v) => `₹${v / 1000}k`}
                      />
                      <Tooltip
                        formatter={(v) => formatINR(Number(v))}
                        labelStyle={{ fontSize: 12 }}
                        contentStyle={{ fontSize: 12, borderRadius: 6 }}
                      />
                      <Bar
                        dataKey="total"
                        fill="hsl(var(--primary))"
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="payments" className="pt-4">
              <PaymentsTable
                schedules={sub.schedules.filter(
                  (s) => s.status === "CONFIRMED" && s.confirmedTxn,
                )}
                onViewTxn={(txnId) => setFocusTxnId(txnId)}
              />
            </TabsContent>

            <TabsContent value="schedule" className="pt-4">
              <ScheduleTable schedules={sub.schedules} />
            </TabsContent>
          </Tabs>
        </div>

        <aside className="space-y-4">
          <div className="rounded-lg border bg-card p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Payment source
            </div>
            <div className="mt-2 flex items-center gap-2 text-sm">
              {sub.card ? (
                <CreditCard className="h-4 w-4 text-muted-foreground" />
              ) : (
                <Wallet className="h-4 w-4 text-muted-foreground" />
              )}
              <span className="font-medium">
                {sub.card?.name ?? sub.account?.name ?? "—"}
              </span>
            </div>
          </div>

          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Next billing</span>
              <span className="font-medium tabular-nums">
                {new Date(sub.nextBillingDate).toLocaleDateString("en-IN", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                })}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Started</span>
              <span className="tabular-nums">
                {new Date(sub.startedOn).toLocaleDateString("en-IN")}
              </span>
            </div>
            {sub.endsOn && (
              <div className="mt-1 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Ends</span>
                <span className="tabular-nums">
                  {new Date(sub.endsOn).toLocaleDateString("en-IN")}
                </span>
              </div>
            )}
          </div>

          {sub.status === "ACTIVE" && (
            <div className="space-y-2">
              <Button onClick={() => setPayOpen(true)} className="w-full gap-1.5">
                <Play className="h-4 w-4" /> Pay this cycle
              </Button>
              <Button
                variant="outline"
                onClick={handleSkip}
                className="w-full gap-1.5 text-xs"
                size="sm"
              >
                <SkipForward className="h-3.5 w-3.5" /> Skip this cycle
              </Button>
            </div>
          )}
        </aside>
      </div>

      {payOpen && (
        <PaySubscriptionDialog
          open={payOpen}
          onOpenChange={setPayOpen}
          subscription={{
            id: sub.id,
            name: sub.name,
            amount: sub.amount,
            nextBillingDate: sub.nextBillingDate,
            accountId: sub.account?.id ?? null,
            cardId: sub.card?.id ?? null,
          }}
          onPaid={() => globalMutate(`/api/subscriptions/${id}`)}
        />
      )}

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit subscription</DialogTitle>
          </DialogHeader>
          {editOpen && (
            <SubscriptionForm
              initial={{
                id: sub.id,
                name: sub.name,
                amount: sub.amount,
                cycle: sub.cycle,
                nextBillingDate: sub.nextBillingDate,
                startedOn: sub.startedOn,
                endsOn: sub.endsOn,
                accountId: sub.account?.id ?? null,
                cardId: sub.card?.id ?? null,
                autoPay: sub.autoPay,
                notes: sub.notes,
              }}
              onSaved={() => {
                setEditOpen(false);
                globalMutate(`/api/subscriptions/${id}`);
              }}
              onCancel={() => setEditOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {sub.name}?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            {cyclesPaid > 0 ? (
              <>
                <p>
                  This subscription has{" "}
                  <strong>{cyclesPaid} paid cycle{cyclesPaid === 1 ? "" : "s"}</strong>{" "}
                  in history. To preserve the audit trail, the recommended
                  action is to cancel — it stays visible in history but stops
                  generating new charges.
                </p>
                <ul className="ml-4 list-disc text-xs text-muted-foreground">
                  <li>Status becomes Cancelled</li>
                  <li>Upcoming schedule + reminder are removed</li>
                  <li>Paid history transactions are kept</li>
                </ul>
              </>
            ) : (
              <p>
                No paid history exists, so this subscription can be removed
                entirely.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            {cyclesPaid > 0 ? (
              <Button
                variant="destructive"
                onClick={() => handleDelete("soft")}
              >
                Cancel subscription
              </Button>
            ) : (
              <Button
                variant="destructive"
                onClick={() => handleDelete("hard")}
              >
                Delete permanently
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TransactionDetailDialog
        transactionId={focusTxnId}
        open={!!focusTxnId}
        onOpenChange={(o) => !o && setFocusTxnId(null)}
        onDeleted={() => globalMutate(`/api/subscriptions/${id}`)}
      />
    </div>
  );
}

function cycleLabel(c: Subscription["cycle"]): string {
  return (
    {
      WEEKLY: "Weekly",
      MONTHLY: "Monthly",
      QUARTERLY: "Quarterly",
      HALF_YEARLY: "Half-yearly",
      YEARLY: "Yearly",
    } as const
  )[c];
}

function StatusBadge({ status }: { status: Subscription["status"] }) {
  const cls =
    status === "ACTIVE"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
      : status === "PAUSED"
        ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
        : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}>
      {status}
    </span>
  );
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-base font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function PaymentsTable({
  schedules,
  onViewTxn,
}: {
  schedules: Schedule[];
  onViewTxn: (txnId: string) => void;
}) {
  if (schedules.length === 0) {
    return (
      <p className="rounded-lg border border-dashed bg-muted/30 p-6 text-center text-xs text-muted-foreground">
        No paid cycles yet.
      </p>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Cycle</th>
            <th className="px-3 py-2 text-left font-medium">Paid on</th>
            <th className="px-3 py-2 text-right font-medium">Amount</th>
            <th className="px-3 py-2 text-right font-medium">Transaction</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {schedules.map((s) => (
            <tr key={s.id}>
              <td className="px-3 py-2 text-xs">
                {new Date(s.dueDate).toLocaleDateString("en-IN", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                })}
              </td>
              <td className="px-3 py-2 text-xs">
                {s.confirmedTxn
                  ? new Date(s.confirmedTxn.date).toLocaleDateString("en-IN")
                  : "—"}
              </td>
              <td className="px-3 py-2 text-right font-medium tabular-nums">
                {formatINR(s.confirmedTxn?.amount ?? s.amount)}
              </td>
              <td className="px-3 py-2 text-right">
                {s.confirmedTxn && (
                  <button
                    type="button"
                    onClick={() => onViewTxn(s.confirmedTxn!.id)}
                    className="text-xs text-primary hover:underline"
                  >
                    View
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ScheduleTable({ schedules }: { schedules: Schedule[] }) {
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Due</th>
            <th className="px-3 py-2 text-right font-medium">Amount</th>
            <th className="px-3 py-2 text-left font-medium">Status</th>
            <th className="px-3 py-2 text-left font-medium">Note</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {schedules.map((s) => (
            <tr key={s.id}>
              <td className="px-3 py-2 text-xs">
                {new Date(s.dueDate).toLocaleDateString("en-IN", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                })}
              </td>
              <td className="px-3 py-2 text-right font-medium tabular-nums">
                {formatINR(s.amount)}
              </td>
              <td className="px-3 py-2 text-xs">
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    s.status === "CONFIRMED"
                      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                      : s.status === "UPCOMING"
                        ? "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300"
                        : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                  }`}
                >
                  {s.status}
                </span>
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground">
                {s.skippedReason ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
