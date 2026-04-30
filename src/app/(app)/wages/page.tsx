"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { toast } from "sonner";
import { CalendarDays, CheckCircle2, Coins } from "lucide-react";
import { FarmSubNav } from "@/components/layout/farm-sub-nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DateInput } from "@/components/ui/date-input";
import { AmountInput } from "@/components/ui/amount-input";
import { NativeSelect } from "@/components/ui/native-select";
import { formatINR, formatDate, accountSpendable, groupAccountOptions } from "@/lib/utils";
import { mutateBalances } from "@/lib/mutate-balances";
import { MarkAttendanceModal } from "@/components/workers/mark-attendance-modal";

type Worker = {
  id: string;
  name: string;
  dailyRate: number | null;
  active: boolean;
  balance: number;
  daysWorked: number;
};
type Attendance = {
  id: string;
  workerId: string;
  date: string;
  present: boolean;
  dailyRateOverride: number | null;
  quantity: number | null;
  rate: number | null;
};
type Payment = {
  id: string;
  workerId: string;
  amount: number;
  paidAt: string;
  isBonus: boolean;
  isAdvance: boolean;
  notes: string | null;
  worker: { id: string; name: string };
  paidByUser: { id: string; name: string } | null;
};
type Account = {
  id: string;
  name: string;
  kind: string;
  balance: number;
  availableLimit: number | null;
};
type CropBatch = {
  id: string;
  name: string;
  status: string;
  active: boolean;
  crop: { id: string; name: string };
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

type PayEntry = {
  selected: boolean;
  amount: string;
  date: string;
  notes: string;
  isBonus: boolean;
  accountId: string;
  cropBatchId: string;
};

export default function WagesPage() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const monthStr = `${year}-${String(month).padStart(2, "0")}`;
  const [viewWorkerId, setViewWorkerId] = useState<string>("");

  const { data: workersData } = useSWR<{ workers: Worker[] }>("/api/workers", fetcher);
  const { data: attendanceData, mutate: mutateAttendance } = useSWR<{
    attendance: Attendance[];
  }>(`/api/attendance?month=${monthStr}`, fetcher);
  const { data: paymentsData, mutate: mutatePayments } = useSWR<{
    payments: Payment[];
  }>(`/api/wage-payments?month=${monthStr}`, fetcher);
  const { data: accountsData } = useSWR<{ accounts: Account[] }>("/api/accounts", fetcher);
  const { data: batchesData } = useSWR<{ batches: CropBatch[] }>(
    "/api/crop-batches?active=true",
    fetcher
  );

  const workers = useMemo(() => workersData?.workers ?? [], [workersData]);
  const attendance = useMemo(() => attendanceData?.attendance ?? [], [attendanceData]);
  const payments = useMemo(() => paymentsData?.payments ?? [], [paymentsData]);
  const accounts = accountsData?.accounts ?? [];
  const batches = batchesData?.batches ?? [];

  const activeWorkers = useMemo(() => workers.filter((w) => w.active), [workers]);
  const visibleWorkers = useMemo(
    () => (viewWorkerId ? activeWorkers.filter((w) => w.id === viewWorkerId) : activeWorkers),
    [activeWorkers, viewWorkerId]
  );

  const totalDays = daysInMonth(year, month);
  const dayNumbers = useMemo(
    () => Array.from({ length: totalDays }, (_, i) => i + 1),
    [totalDays]
  );

  const attendanceMap = useMemo(() => {
    const map = new Map<string, Attendance>();
    attendance.forEach((a) => {
      map.set(`${a.workerId}:${a.date.slice(0, 10)}`, a);
    });
    return map;
  }, [attendance]);

  const workerStats = useMemo(() => {
    const stats = new Map<
      string,
      { daysPresent: number; daysLeave: number; earned: number; paid: number; balance: number }
    >();
    activeWorkers.forEach((w) => {
      const defaultRate = w.dailyRate ?? 0;
      let daysPresent = 0;
      let daysLeave = 0;
      let earned = 0;
      attendance.forEach((a) => {
        if (a.workerId !== w.id) return;
        if (a.present) {
          daysPresent++;
          const rate = a.dailyRateOverride ?? a.rate ?? defaultRate;
          earned += rate * (a.quantity ?? 1);
        } else {
          daysLeave++;
        }
      });
      const paid = payments
        .filter((p) => p.workerId === w.id && !p.isBonus)
        .reduce((s, p) => s + p.amount, 0);
      stats.set(w.id, { daysPresent, daysLeave, earned, paid, balance: earned - paid });
    });
    return stats;
  }, [activeWorkers, attendance, payments]);

  // Mark-attendance modal — opened by clicking a calendar cell
  const [modalOpen, setModalOpen] = useState(false);
  const [modalWorkerId, setModalWorkerId] = useState<string>("");
  const [modalDate, setModalDate] = useState<string>("");

  function openCell(workerId: string, date: string) {
    setModalWorkerId(workerId);
    setModalDate(date);
    setModalOpen(true);
  }

  // Pay-wages form — one row per active worker
  const todayIso = isoDate(new Date());
  const [payEntries, setPayEntries] = useState<Record<string, PayEntry>>({});
  const [paying, setPaying] = useState<string | null>(null);

  const workerIds = activeWorkers.map((w) => w.id).join(",");
  useEffect(() => {
    if (!activeWorkers.length) return;
    /* eslint-disable react-hooks/set-state-in-effect -- one-shot init per worker set */
    setPayEntries((prev) => {
      const next: Record<string, PayEntry> = {};
      activeWorkers.forEach((w) => {
        next[w.id] = prev[w.id] ?? {
          selected: false,
          amount: "0",
          date: todayIso,
          notes: "",
          isBonus: false,
          accountId: "",
          cropBatchId: "maintenance",
        };
      });
      return next;
    });
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: one-shot per worker set
  }, [workerIds]);

  function updatePay(id: string, patch: Partial<PayEntry>) {
    setPayEntries((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  async function handlePay(worker: { id: string; name: string }) {
    const e = payEntries[worker.id];
    if (!e?.selected) return;
    const amt = parseFloat(e.amount) || 0;
    if (!(amt > 0)) {
      toast.error("Enter an amount");
      return;
    }
    if (!e.accountId) {
      toast.error("Pick an account / mode");
      return;
    }
    setPaying(worker.id);
    const res = await fetch("/api/wage-payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workerId: worker.id,
        amount: amt,
        paidAt: e.date,
        notes: e.notes || undefined,
        isBonus: e.isBonus,
        accountId: e.accountId,
      }),
    });
    setPaying(null);
    if (res.ok) {
      toast.success(`${e.isBonus ? "Bonus" : "Payment"} recorded for ${worker.name}`);
      updatePay(worker.id, {
        selected: false,
        amount: "0",
        notes: "",
        isBonus: false,
        accountId: "",
      });
      mutatePayments();
      globalMutate("/api/workers");
      mutateBalances();
    } else {
      const body = await res.json().catch(() => null);
      toast.error(body?.error ?? "Failed to record payment");
    }
  }

  return (
    <div className="space-y-6">
      <FarmSubNav />
      <div>
        <p className="text-xs font-semibold text-primary uppercase tracking-wider mb-2">
          Farm Activity
        </p>
        <h1 className="text-2xl font-bold flex items-center gap-3">
          <CalendarDays className="h-7 w-7" />
          Wages &amp; Attendance
        </h1>
        <div className="h-1 w-16 bg-primary mt-3" />
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <Label className="text-sm shrink-0">Month</Label>
          <div className="w-40">
            <NativeSelect
              value={String(month)}
              onChange={(next) => setMonth(Number(next))}
              options={Array.from({ length: 12 }, (_, i) => i + 1).map((m) => ({
                value: String(m),
                label: new Date(2000, m - 1, 1).toLocaleString("en", { month: "long" }),
              }))}
            />
          </div>
          <Input
            type="number"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="w-24 h-9"
          />
        </div>
        <div className="flex items-center gap-2 sm:ml-auto">
          <Label className="text-sm shrink-0">View worker</Label>
          <div className="min-w-44">
            <NativeSelect
              value={viewWorkerId}
              onChange={setViewWorkerId}
              placeholder="All workers"
              options={activeWorkers.map((w) => ({ value: w.id, label: w.name }))}
            />
          </div>
        </div>
      </div>

      {/* Attendance grid */}
      <section className="rounded-xl border bg-card">
        <header className="px-5 py-4 border-b">
          <h2 className="text-sm font-semibold">Attendance</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Click a cell to toggle. Select a worker above to see their full calendar and balance.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm bg-emerald-500" /> Present
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm bg-rose-300" /> Leave
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm border border-border bg-muted" /> Not
              marked
            </span>
          </div>
        </header>
        <div className="overflow-x-auto">
          {visibleWorkers.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted-foreground text-center">
              No active workers. Add them from the Workers page.
            </p>
          ) : (
            <table className="text-xs border-collapse w-max min-w-full">
              <thead>
                <tr>
                  <th className="sticky left-0 bg-card text-left px-3 py-2 border-b min-w-[140px]">
                    Worker
                  </th>
                  {dayNumbers.map((d) => (
                    <th
                      key={d}
                      className="px-0.5 py-2 border-b w-8 text-center font-normal text-muted-foreground"
                    >
                      {d}
                    </th>
                  ))}
                  <th className="px-3 py-2 border-b text-right">Days</th>
                  <th className="px-3 py-2 border-b text-right">Leave</th>
                </tr>
              </thead>
              <tbody>
                {visibleWorkers.map((w) => {
                  const stat = workerStats.get(w.id);
                  return (
                    <tr key={w.id}>
                      <td className="sticky left-0 bg-card px-3 py-1 border-b font-medium">
                        {w.name}
                      </td>
                      {dayNumbers.map((d) => {
                        const date = `${monthStr}-${String(d).padStart(2, "0")}`;
                        const entry = attendanceMap.get(`${w.id}:${date}`);
                        const isFuture = date > todayIso;
                        const present = entry?.present;
                        const cls = isFuture
                          ? "bg-muted/40 text-muted-foreground/40 cursor-not-allowed"
                          : present === true
                            ? "bg-emerald-500 text-white hover:bg-emerald-600 cursor-pointer"
                            : present === false
                              ? "bg-rose-300 text-rose-900 hover:bg-rose-400 cursor-pointer"
                              : "bg-background hover:bg-accent cursor-pointer";
                        return (
                          <td
                            key={d}
                            onClick={() => !isFuture && openCell(w.id, date)}
                            className={`w-8 h-8 border border-border/60 text-center align-middle ${cls}`}
                            title={date}
                          >
                            {!isFuture && present === true
                              ? "✓"
                              : !isFuture && present === false
                                ? "L"
                                : ""}
                          </td>
                        );
                      })}
                      <td className="px-3 py-1 border-b text-right font-semibold">
                        {stat?.daysPresent ?? 0}
                      </td>
                      <td className="px-3 py-1 border-b text-right font-semibold text-rose-600">
                        {stat?.daysLeave ?? 0}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Wage balance */}
      <section className="rounded-xl border bg-card">
        <header className="px-5 py-4 border-b">
          <h2 className="text-sm font-semibold">
            Wage Balance (
            {new Date(year, month - 1, 1).toLocaleString("en", {
              month: "long",
              year: "numeric",
            })}
            )
          </h2>
        </header>
        {visibleWorkers.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground text-center">
            No active workers.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b">
                <th className="px-5 py-2.5">Worker</th>
                <th className="px-5 py-2.5 text-right">Days</th>
                <th className="px-5 py-2.5 text-right">Earned</th>
                <th className="px-5 py-2.5 text-right">Paid</th>
                <th className="px-5 py-2.5 text-right">Pending</th>
              </tr>
            </thead>
            <tbody>
              {visibleWorkers.map((w) => {
                const s = workerStats.get(w.id);
                return (
                  <tr key={w.id} className="border-b last:border-0">
                    <td className="px-5 py-2.5 font-medium">{w.name}</td>
                    <td className="px-5 py-2.5 text-right">{s?.daysPresent ?? 0}</td>
                    <td className="px-5 py-2.5 text-right">{formatINR(s?.earned ?? 0)}</td>
                    <td className="px-5 py-2.5 text-right">{formatINR(s?.paid ?? 0)}</td>
                    <td
                      className={`px-5 py-2.5 text-right font-semibold ${
                        (s?.balance ?? 0) > 0 ? "text-rose-600" : "text-emerald-700"
                      }`}
                    >
                      {formatINR(s?.balance ?? 0)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {/* Pay wages */}
      <section className="rounded-xl border bg-card">
        <header className="px-5 py-4 border-b">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Coins className="h-4 w-4" /> Pay Wages
          </h2>
        </header>
        {visibleWorkers.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground text-center">
            No active workers.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[820px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground [&>th]:sticky [&>th]:top-0 [&>th]:z-10 [&>th]:bg-muted/30 [&>th]:border-b">
                  <th className="py-2 px-3 w-8" />
                  <th className="py-2 px-2">Worker</th>
                  <th className="py-2 px-2">Pending</th>
                  <th className="py-2 px-2 w-28">Amount ₹</th>
                  <th className="py-2 px-2 w-36">Date</th>
                  <th className="py-2 px-2">Notes</th>
                  <th className="py-2 px-2 w-32">Mode</th>
                  <th className="py-2 px-2 w-36">Crop / Batch</th>
                  <th className="py-2 px-2 text-center w-12">Bonus</th>
                  <th className="py-2 px-2 w-16" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {visibleWorkers.map((w) => {
                  const s = workerStats.get(w.id);
                  const e = payEntries[w.id];
                  if (!e) return null;
                  const selectedAcc = accounts.find((a) => a.id === e.accountId);
                  const amt = parseFloat(e.amount) || 0;
                  const selectedSpendable = selectedAcc ? accountSpendable(selectedAcc) : null;
                  const insufficient =
                    !!selectedAcc && selectedSpendable != null && amt > selectedSpendable;
                  return (
                    <tr key={w.id} className={e.selected ? "bg-primary/5" : ""}>
                      <td className="py-2.5 px-3">
                        <input
                          type="checkbox"
                          checked={e.selected}
                          onChange={() => updatePay(w.id, { selected: !e.selected })}
                          className="h-4 w-4 accent-primary"
                        />
                      </td>
                      <td className="py-2.5 px-2 font-medium whitespace-nowrap">{w.name}</td>
                      <td
                        className={`py-2.5 px-2 text-xs whitespace-nowrap ${
                          (s?.balance ?? 0) > 0
                            ? "text-rose-600 font-medium"
                            : "text-muted-foreground"
                        }`}
                      >
                        {formatINR(s?.balance ?? 0)}
                      </td>
                      <td className="py-2.5 px-2">
                        <AmountInput
                          value={e.amount}
                          onChange={(v) => updatePay(w.id, { amount: v })}
                          placeholder="0"
                          disabled={!e.selected}
                        />
                      </td>
                      <td className="py-2.5 px-2">
                        <DateInput
                          value={e.date}
                          max={todayIso}
                          onChange={(ev) => updatePay(w.id, { date: ev.target.value })}
                          disabled={!e.selected}
                        />
                      </td>
                      <td className="py-2.5 px-2">
                        <Input
                          value={e.notes}
                          onChange={(ev) => updatePay(w.id, { notes: ev.target.value })}
                          placeholder="Notes"
                          disabled={!e.selected}
                        />
                      </td>
                      <td className="py-2.5 px-2">
                        <NativeSelect
                          value={e.accountId}
                          onChange={(next) => updatePay(w.id, { accountId: next })}
                          disabled={!e.selected}
                          placeholder="No account"
                          options={groupAccountOptions(accounts, amt)}
                        />
                        {insufficient && selectedAcc && selectedSpendable != null && (
                          <p className="text-[10px] text-rose-500 mt-0.5">
                            {selectedAcc.kind === "CARD" ? "Limit left:" : "Balance:"}{" "}
                            {formatINR(selectedSpendable)}
                          </p>
                        )}
                      </td>
                      <td className="py-2.5 px-2">
                        <NativeSelect
                          value={e.cropBatchId}
                          onChange={(next) => updatePay(w.id, { cropBatchId: next })}
                          disabled={!e.selected}
                          options={[
                            { value: "maintenance", label: "Maintenance" },
                            ...batches
                              .filter((b) => b.active)
                              .map((b) => ({
                                value: b.id,
                                label: `${b.crop.name} / ${b.name}`,
                              })),
                          ]}
                        />
                      </td>
                      <td className="py-2.5 px-2 text-center">
                        {e.selected && (
                          <input
                            type="checkbox"
                            checked={e.isBonus}
                            onChange={() => updatePay(w.id, { isBonus: !e.isBonus })}
                            className="h-4 w-4 accent-primary"
                          />
                        )}
                      </td>
                      <td className="py-2.5 px-2">
                        <Button
                          size="sm"
                          onClick={() => handlePay(w)}
                          disabled={
                            paying === w.id || !e.selected || !(amt > 0) || insufficient
                          }
                        >
                          {paying === w.id ? "…" : "Pay"}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Recent payments */}
      <section className="rounded-xl border bg-card">
        <header className="px-5 py-4 border-b">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" /> Recent Payments
          </h2>
        </header>
        {(() => {
          const filtered = viewWorkerId
            ? payments.filter((p) => p.workerId === viewWorkerId)
            : payments;
          if (filtered.length === 0) {
            return (
              <p className="px-5 py-6 text-sm text-muted-foreground text-center">
                No payments yet.
              </p>
            );
          }
          return (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[520px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b bg-muted/30">
                    <th className="py-2 px-5">Date</th>
                    <th className="py-2 px-5">Worker</th>
                    <th className="py-2 px-5">Amount</th>
                    <th className="py-2 px-5 hidden sm:table-cell">Paid by</th>
                    <th className="py-2 px-5 hidden md:table-cell">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => (
                    <tr key={p.id} className="border-b last:border-0">
                      <td className="py-2.5 px-5 text-muted-foreground whitespace-nowrap">
                        {formatDate(p.paidAt)}
                      </td>
                      <td className="py-2.5 px-5 font-medium">{p.worker.name}</td>
                      <td className="py-2.5 px-5 font-semibold whitespace-nowrap">
                        {formatINR(p.amount)}
                        {p.isBonus && (
                          <span className="ml-1.5 text-[10px] font-semibold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">
                            Bonus
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-5 text-muted-foreground hidden sm:table-cell">
                        {p.paidByUser?.name ?? "—"}
                      </td>
                      <td className="py-2.5 px-5 text-muted-foreground hidden md:table-cell">
                        {p.notes ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })()}
      </section>

      {modalWorkerId && (
        <MarkAttendanceModal
          open={modalOpen}
          onOpenChange={setModalOpen}
          workers={activeWorkers.map((w) => ({
            id: w.id,
            name: w.name,
            dailyRate: w.dailyRate,
          }))}
          onSaved={() => {
            mutateAttendance();
            globalMutate("/api/workers");
          }}
          preselectedIds={[modalWorkerId]}
          focused
          initialDate={modalDate}
        />
      )}
    </div>
  );
}
