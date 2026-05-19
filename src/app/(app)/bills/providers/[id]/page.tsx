"use client";

import { use, useMemo, useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import Link from "next/link";
import {
  ArrowLeft,
  Pencil,
  Plus,
  Trash2,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatINR } from "@/lib/utils";
import {
  UtilityKindIcon,
  utilityKindLabel,
  type UtilityKindValue,
} from "@/components/bills/utility-kind";
import { UtilityProviderForm } from "@/components/bills/utility-provider-form";
import { AddAdvanceDialog } from "@/components/bills/add-advance-dialog";
import { UtilityBillForm } from "@/components/bills/utility-bill-form";
import { PayBillDialog } from "@/components/bills/pay-bill-dialog";

type Provider = {
  id: string;
  kind: UtilityKindValue;
  providerName: string;
  connectionNumber: string | null;
  addressLine: string | null;
  accountId: string | null;
  cardId: string | null;
  account: { id: string; name: string; kind: string } | null;
  card: { id: string; name: string } | null;
  autoPay: boolean;
  defaultDueDay: number | null;
  advanceBalance: number;
  status: "ACTIVE" | "INACTIVE";
  notes: string | null;
};

type Bill = {
  id: string;
  providerId: string;
  billDate: string;
  dueDate: string;
  billAmount: number;
  previousReading: number | null;
  currentReading: number | null;
  unitsConsumed: number | null;
  advanceApplied: number;
  paidAt: string | null;
  paidTransaction: {
    id: string;
    amount: number;
    account: { id: string; name: string } | null;
    card: { id: string; name: string } | null;
  } | null;
  attachmentCount: number;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function ProviderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data: providerRes, isLoading } = useSWR<{ provider: Provider }>(
    `/api/utility-providers/${id}`,
    fetcher,
  );
  const { data: billsRes } = useSWR<{ bills: Bill[] }>(
    `/api/utility-bills?providerId=${id}`,
    fetcher,
  );
  const [editOpen, setEditOpen] = useState(false);
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [newBillOpen, setNewBillOpen] = useState(false);
  const [payBill, setPayBill] = useState<Bill | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const provider = providerRes?.provider;
  const bills = useMemo(() => billsRes?.bills ?? [], [billsRes]);

  const lastPaidBill = useMemo(
    () =>
      bills
        .filter((b) => b.paidAt && b.currentReading != null)
        .sort((a, b) => new Date(b.billDate).getTime() - new Date(a.billDate).getTime())[0],
    [bills],
  );

  const monthlyChart = useMemo(() => {
    // Last 12 months — units (if EB) and amount.
    const months: { month: string; units: number; cost: number }[] = [];
    const cursor = new Date();
    cursor.setDate(1);
    cursor.setHours(0, 0, 0, 0);
    for (let i = 11; i >= 0; i--) {
      const ref = new Date(cursor);
      ref.setMonth(ref.getMonth() - i);
      months.push({
        month: ref.toLocaleDateString("en-IN", { month: "short" }),
        units: 0,
        cost: 0,
      });
    }
    for (const b of bills) {
      const d = new Date(b.billDate);
      const monthsBack =
        (cursor.getFullYear() - d.getFullYear()) * 12 +
        (cursor.getMonth() - d.getMonth());
      const idx = 11 - monthsBack;
      if (idx >= 0 && idx < months.length) {
        months[idx].units += b.unitsConsumed ?? 0;
        months[idx].cost += b.billAmount;
      }
    }
    return months;
  }, [bills]);

  const costPerUnit = useMemo(
    () =>
      monthlyChart.map((m) => ({
        month: m.month,
        rate: m.units > 0 ? +(m.cost / m.units).toFixed(2) : 0,
      })),
    [monthlyChart],
  );

  if (isLoading || !provider) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const thisMonthBill = bills.find((b) => {
    const d = new Date(b.billDate);
    const t = new Date();
    return d.getMonth() === t.getMonth() && d.getFullYear() === t.getFullYear();
  });
  const last12Spend = monthlyChart.reduce((s, m) => s + m.cost, 0);
  const avgMonthly = last12Spend / 12;

  async function handleHardDelete() {
    const res = await fetch(`/api/utility-providers/${id}?hard=1`, {
      method: "DELETE",
    });
    const body = await res.json().catch(() => ({}));
    if (body.mode === "hard") {
      window.location.href = "/bills";
    } else {
      // Fell back to soft — still refresh.
      window.location.href = "/bills";
    }
  }
  async function handleSoftDelete() {
    const res = await fetch(`/api/utility-providers/${id}`, { method: "DELETE" });
    if (res.ok) window.location.href = "/bills";
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/bills"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> Back to bills
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <header className="rounded-lg border bg-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="rounded-md bg-muted p-2.5">
                  <UtilityKindIcon kind={provider.kind} className="h-5 w-5" />
                </div>
                <div>
                  <h1 className="text-xl font-semibold">{provider.providerName}</h1>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {utilityKindLabel(provider.kind)}
                    {provider.connectionNumber
                      ? ` · ${provider.connectionNumber}`
                      : ""}
                  </div>
                  {provider.addressLine && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      {provider.addressLine}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                  <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
                </Button>
              </div>
            </div>
          </header>

          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="bills">
                Bills{" "}
                <span className="ml-1 text-[9px] text-muted-foreground">
                  ({bills.length})
                </span>
              </TabsTrigger>
              <TabsTrigger value="advances">Advances</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-4 pt-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <KpiCard
                  label="Advance"
                  value={formatINR(provider.advanceBalance)}
                />
                <KpiCard
                  label="This month"
                  value={thisMonthBill ? formatINR(thisMonthBill.billAmount) : "—"}
                />
                <KpiCard label="Last 12mo" value={formatINR(last12Spend)} />
                <KpiCard label="Avg / mo" value={formatINR(avgMonthly)} />
              </div>

              {provider.kind === "ELECTRICITY" ? (
                <>
                  <ChartCard title="Units consumed (last 12 months)">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={monthlyChart}>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                        <XAxis dataKey="month" fontSize={11} />
                        <YAxis fontSize={11} />
                        <Tooltip
                          formatter={(v) => `${Number(v).toFixed(1)} units`}
                          contentStyle={{ fontSize: 12, borderRadius: 6 }}
                        />
                        <Area
                          type="monotone"
                          dataKey="units"
                          stroke="hsl(var(--primary))"
                          fill="hsl(var(--primary))"
                          fillOpacity={0.2}
                          strokeWidth={2}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </ChartCard>
                  <ChartCard title="Cost per unit (₹/unit)">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={costPerUnit}>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                        <XAxis dataKey="month" fontSize={11} />
                        <YAxis fontSize={11} />
                        <Tooltip
                          formatter={(v) => `₹${Number(v).toFixed(2)}`}
                          contentStyle={{ fontSize: 12, borderRadius: 6 }}
                        />
                        <Line
                          type="monotone"
                          dataKey="rate"
                          stroke="hsl(var(--primary))"
                          strokeWidth={2}
                          dot={{ r: 3 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </ChartCard>
                </>
              ) : (
                <ChartCard title="Monthly spend (last 12 months)">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={monthlyChart}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                      <XAxis dataKey="month" fontSize={11} />
                      <YAxis
                        fontSize={11}
                        tickFormatter={(v) => `₹${v / 1000}k`}
                      />
                      <Tooltip
                        formatter={(v) => formatINR(Number(v))}
                        contentStyle={{ fontSize: 12, borderRadius: 6 }}
                      />
                      <Bar
                        dataKey="cost"
                        fill="hsl(var(--primary))"
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>
              )}
            </TabsContent>

            <TabsContent value="bills" className="pt-4">
              <BillsTable
                bills={bills}
                provider={provider}
                onPay={(b) => setPayBill(b)}
                onChanged={() => {
                  globalMutate(`/api/utility-bills?providerId=${id}`);
                  globalMutate(`/api/utility-providers/${id}`);
                  globalMutate("/api/utility-providers");
                }}
              />
            </TabsContent>

            <TabsContent value="advances" className="pt-4">
              <AdvancesTable providerId={id} />
            </TabsContent>
          </Tabs>
        </div>

        <aside className="space-y-4">
          <div className="rounded-lg border bg-card p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Advance balance
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">
              {formatINR(provider.advanceBalance)}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Each new bill draws from this balance first; only the
              shortfall is charged to your account/card.
            </p>
          </div>

          <div className="rounded-lg border bg-card p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Default source
            </div>
            <div className="mt-2 flex items-center gap-2 text-sm">
              <Wallet className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">
                {provider.card?.name ?? provider.account?.name ?? "Not set"}
              </span>
            </div>
            {provider.autoPay && (
              <div className="mt-1 text-[10px] uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                Auto-pay enabled
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Button
              onClick={() => setNewBillOpen(true)}
              className="w-full gap-1.5"
            >
              <Plus className="h-4 w-4" /> Record bill
            </Button>
            <Button
              variant="outline"
              onClick={() => setAdvanceOpen(true)}
              className="w-full gap-1.5 text-xs"
              size="sm"
            >
              <Plus className="h-3.5 w-3.5" /> Add advance
            </Button>
          </div>
        </aside>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit provider</DialogTitle>
          </DialogHeader>
          {editOpen && (
            <UtilityProviderForm
              initial={{
                id: provider.id,
                kind: provider.kind,
                providerName: provider.providerName,
                connectionNumber: provider.connectionNumber,
                addressLine: provider.addressLine,
                accountId: provider.accountId,
                cardId: provider.cardId,
                autoPay: provider.autoPay,
                defaultDueDay: provider.defaultDueDay,
                notes: provider.notes,
              }}
              onSaved={() => {
                setEditOpen(false);
                globalMutate(`/api/utility-providers/${id}`);
              }}
              onCancel={() => setEditOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      {advanceOpen && (
        <AddAdvanceDialog
          open={advanceOpen}
          onOpenChange={setAdvanceOpen}
          provider={{
            id: provider.id,
            providerName: provider.providerName,
            accountId: provider.accountId,
            cardId: provider.cardId,
          }}
          onSaved={() => {
            globalMutate(`/api/utility-providers/${id}`);
            globalMutate("/api/utility-providers");
          }}
        />
      )}

      <Dialog open={newBillOpen} onOpenChange={setNewBillOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Record bill — {provider.providerName}</DialogTitle>
          </DialogHeader>
          {newBillOpen && <UtilityBillForm
            provider={{
              id: provider.id,
              kind: provider.kind,
              providerName: provider.providerName,
            }}
            previousMeterReading={lastPaidBill?.currentReading ?? null}
            onSaved={() => {
              setNewBillOpen(false);
              globalMutate(`/api/utility-bills?providerId=${id}`);
              globalMutate(`/api/utility-providers/${id}`);
            }}
            onCancel={() => setNewBillOpen(false)}
          />}
        </DialogContent>
      </Dialog>

      {payBill && (
        <PayBillDialog
          open={!!payBill}
          onOpenChange={(o) => !o && setPayBill(null)}
          bill={{
            id: payBill.id,
            billAmount: payBill.billAmount,
            dueDate: payBill.dueDate,
            provider: {
              id: provider.id,
              providerName: provider.providerName,
              advanceBalance: provider.advanceBalance,
              accountId: provider.accountId,
              cardId: provider.cardId,
            },
          }}
          onPaid={() => {
            globalMutate(`/api/utility-bills?providerId=${id}`);
            globalMutate(`/api/utility-providers/${id}`);
            globalMutate("/api/utility-providers");
          }}
        />
      )}

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {provider.providerName}?</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            {bills.length > 0 || provider.advanceBalance > 0 ? (
              <>
                <p>
                  This provider has{" "}
                  <strong>{bills.length} bill{bills.length === 1 ? "" : "s"}</strong>{" "}
                  in history
                  {provider.advanceBalance > 0
                    ? ` and ${formatINR(provider.advanceBalance)} advance balance`
                    : ""}
                  . Deactivating keeps history visible and hides the provider
                  from the &ldquo;Add Bill&rdquo; picker.
                </p>
                <ul className="ml-4 list-disc text-xs text-muted-foreground">
                  <li>Status becomes Inactive</li>
                  <li>Bills + transactions are preserved</li>
                  <li>Advance balance is preserved</li>
                </ul>
              </>
            ) : (
              <p>No bills or advance balance — this provider can be removed entirely.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            {bills.length > 0 || provider.advanceBalance > 0 ? (
              <Button variant="destructive" onClick={handleSoftDelete}>
                Deactivate provider
              </Button>
            ) : (
              <Button variant="destructive" onClick={handleHardDelete}>
                Delete permanently
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <div className="h-56">{children}</div>
    </div>
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

function BillsTable({
  bills,
  provider,
  onPay,
  onChanged,
}: {
  bills: Bill[];
  provider: Provider;
  onPay: (b: Bill) => void;
  onChanged: () => void;
}) {
  const [statusFilter, setStatusFilter] = useState<"all" | "unpaid" | "paid">(
    "all",
  );
  const [deleteTarget, setDeleteTarget] = useState<Bill | null>(null);

  const filtered = useMemo(() => {
    if (statusFilter === "unpaid") return bills.filter((b) => !b.paidAt);
    if (statusFilter === "paid") return bills.filter((b) => b.paidAt);
    return bills;
  }, [bills, statusFilter]);

  async function confirmDelete() {
    if (!deleteTarget) return;
    const res = await fetch(`/api/utility-bills/${deleteTarget.id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setDeleteTarget(null);
      onChanged();
    }
  }

  if (bills.length === 0) {
    return (
      <p className="rounded-lg border border-dashed bg-muted/30 p-6 text-center text-xs text-muted-foreground">
        No bills recorded yet.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-1 rounded-lg border bg-card p-0.5 text-xs">
        {(["all", "unpaid", "paid"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`rounded-md px-3 py-1.5 capitalize ${
              statusFilter === s
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {s}
          </button>
        ))}
      </div>
      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Bill date</th>
              <th className="px-3 py-2 text-left font-medium">Due</th>
              {provider.kind === "ELECTRICITY" && (
                <th className="px-3 py-2 text-right font-medium">Units</th>
              )}
              <th className="px-3 py-2 text-right font-medium">Amount</th>
              <th className="px-3 py-2 text-right font-medium">Advance</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
              <th className="px-3 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {filtered.map((b) => {
              const overdue = !b.paidAt && new Date(b.dueDate) < new Date();
              return (
                <tr key={b.id} className="hover:bg-muted/30">
                  <td className="px-3 py-2 text-xs">{fmtDate(b.billDate)}</td>
                  <td className="px-3 py-2 text-xs">
                    {fmtDate(b.dueDate)}
                  </td>
                  {provider.kind === "ELECTRICITY" && (
                    <td className="px-3 py-2 text-right text-xs tabular-nums">
                      {b.unitsConsumed != null
                        ? b.unitsConsumed.toFixed(1)
                        : "—"}
                    </td>
                  )}
                  <td className="px-3 py-2 text-right font-medium tabular-nums">
                    {formatINR(b.billAmount)}
                  </td>
                  <td className="px-3 py-2 text-right text-xs tabular-nums text-muted-foreground">
                    {b.advanceApplied > 0 ? formatINR(b.advanceApplied) : "—"}
                  </td>
                  <td className="px-3 py-2">
                    {b.paidAt ? (
                      <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                        Paid
                      </span>
                    ) : overdue ? (
                      <span className="inline-flex items-center rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-medium text-rose-700 dark:bg-rose-950 dark:text-rose-300">
                        Overdue
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                        Pending
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      {!b.paidAt && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => onPay(b)}
                        >
                          Pay
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-destructive"
                        onClick={() => setDeleteTarget(b)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete bill?</DialogTitle>
          </DialogHeader>
          {deleteTarget && (
            <div className="space-y-2 text-sm">
              <p>
                <strong>{fmtDate(deleteTarget.billDate)}</strong> ·{" "}
                {formatINR(deleteTarget.billAmount)}
              </p>
              {deleteTarget.paidAt ? (
                <>
                  <p>
                    This bill is paid. Deleting will:
                  </p>
                  <ul className="ml-4 list-disc text-xs text-muted-foreground">
                    <li>Delete the linked payment transaction</li>
                    {deleteTarget.advanceApplied > 0 && (
                      <li>
                        Return{" "}
                        <strong>
                          {formatINR(deleteTarget.advanceApplied)}
                        </strong>{" "}
                        to {provider.providerName} advance balance
                      </li>
                    )}
                    <li>Remove the reminder</li>
                  </ul>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Removes the unpaid bill and its reminder.
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete}>
              Delete bill
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AdvancesTable({ providerId }: { providerId: string }) {
  const { data, isLoading } = useSWR<{
    transactions: {
      id: string;
      amount: number;
      date: string;
      description: string;
      account: { id: string; name: string } | null;
      card: { id: string; name: string } | null;
    }[];
  }>(
    `/api/transactions?utilityProviderId=${providerId}&kind=UTILITY_ADVANCE&limit=100`,
    fetcher,
  );

  if (isLoading) return <Skeleton className="h-32" />;
  const rows = data?.transactions ?? [];
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed bg-muted/30 p-6 text-center text-xs text-muted-foreground">
        No advance deposits yet.
      </p>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Date</th>
            <th className="px-3 py-2 text-left font-medium">Source</th>
            <th className="px-3 py-2 text-left font-medium">Note</th>
            <th className="px-3 py-2 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((t) => (
            <tr key={t.id}>
              <td className="px-3 py-2 text-xs">{fmtDate(t.date)}</td>
              <td className="px-3 py-2 text-xs">
                {t.card?.name ?? t.account?.name ?? "—"}
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground">
                {t.description}
              </td>
              <td className="px-3 py-2 text-right font-medium tabular-nums">
                {formatINR(t.amount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
