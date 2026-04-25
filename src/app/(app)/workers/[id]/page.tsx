"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR, { mutate as globalMutate } from "swr";
import { toast } from "sonner";
import { Check, X, Trash2, CalendarDays, Wallet2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { mutateBalances } from "@/lib/mutate-balances";
import { formatINR, formatDate } from "@/lib/utils";

type Balance = {
  workerId: string;
  earned: number;
  paidFromWages: number;
  balance: number;
  bonuses: number;
  advances: number;
  daysWorked: number;
};
type Attendance = {
  id: string;
  date: string;
  present: boolean;
  dailyRateOverride: number | null;
  quantity: number | null;
  rate: number | null;
  notes: string | null;
};
type Payment = {
  id: string;
  amount: number;
  paidAt: string;
  isBonus: boolean;
  isAdvance: boolean;
  notes: string | null;
};
type Settlement = {
  id: string;
  periodStart: string;
  periodEnd: string;
  cadence: string;
  earnedAmount: number;
  paidAmount: number;
  amountDue: number;
  status: "PENDING" | "SETTLED" | "CANCELLED";
  settledAt: string | null;
};
type WorkerDetail = {
  worker: {
    id: string;
    name: string;
    phone: string | null;
    dailyRate: number | null;
    settlementCadence: "WEEKLY" | "MONTHLY" | "CUSTOM";
    customCadenceDays: number | null;
    active: boolean;
  };
  balance: Balance;
  attendance: Attendance[];
  payments: Payment[];
  settlements: Settlement[];
};
type Account = { id: string; name: string; kind: string };

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function WorkerDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const { data } = useSWR<WorkerDetail>(id ? `/api/workers/${id}` : null, fetcher);
  const { data: accountsData } = useSWR<{ accounts: Account[] }>("/api/accounts", fetcher);
  const accounts = (accountsData?.accounts ?? []).filter((a) => a.kind !== "CARD");

  const [attendanceOpen, setAttendanceOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [settleOpen, setSettleOpen] = useState<Settlement | null>(null);

  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/workers" className="text-xs text-muted-foreground">
          ← Workers
        </Link>
        <div className="mt-1 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{data.worker.name}</h1>
            <div className="text-xs text-muted-foreground">
              {data.worker.phone ?? "no phone"} ·{" "}
              {data.worker.dailyRate != null ? `₹${data.worker.dailyRate}/day` : "no rate"} ·{" "}
              {data.worker.settlementCadence}
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setAttendanceOpen(true)} className="gap-1.5">
              <CalendarDays className="h-4 w-4" /> Attendance
            </Button>
            <Button onClick={() => setPayOpen(true)} className="gap-1.5">
              <Wallet2 className="h-4 w-4" /> Pay
            </Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="Owed balance"
          value={formatINR(data.balance.balance)}
          tone={
            data.balance.balance > 0
              ? "primary"
              : data.balance.balance < 0
                ? "destructive"
                : "muted"
          }
          hint={data.balance.balance > 0 ? "Pay worker" : data.balance.balance < 0 ? "Worker in advance" : "Cleared"}
          highlight
        />
        <Stat label="Earned" value={formatINR(data.balance.earned)} />
        <Stat label="Paid" value={formatINR(data.balance.paidFromWages)} />
        <Stat
          label="Bonuses"
          value={formatINR(data.balance.bonuses)}
          hint="Not deducted from balance"
        />
      </div>

      {data.settlements.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-2">Settlements</h2>
          <div className="rounded-xl border bg-card divide-y">
            {data.settlements.map((s) => (
              <div key={s.id} className="flex items-center gap-3 px-5 py-3">
                <div className="flex-1 min-w-0">
                  <div className="font-medium">
                    {formatDate(s.periodStart)} → {formatDate(s.periodEnd)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {s.cadence} · earned {formatINR(s.earnedAmount)} · paid{" "}
                    {formatINR(s.paidAmount)}
                  </div>
                </div>
                <div className="text-right">
                  <div
                    className={`font-semibold ${s.amountDue > 0 ? "text-primary" : "text-muted-foreground"}`}
                  >
                    {formatINR(s.amountDue)}
                  </div>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    {s.status}
                  </div>
                </div>
                {s.status === "PENDING" && (
                  <Button size="sm" variant="outline" onClick={() => setSettleOpen(s)}>
                    Settle
                  </Button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="text-sm font-semibold mb-2">Recent attendance</h2>
        <div className="rounded-xl border bg-card divide-y">
          {data.attendance.map((a) => {
            const earned =
              a.rate != null && a.quantity != null
                ? a.rate * a.quantity
                : a.dailyRateOverride ?? data.worker.dailyRate ?? 0;
            return (
              <div key={a.id} className="flex items-center gap-3 px-5 py-2.5">
                <div
                  className={`h-7 w-7 rounded-full flex items-center justify-center ${
                    a.present ? "bg-accent text-primary" : "bg-muted text-muted-foreground"
                  }`}
                >
                  {a.present ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm">{formatDate(a.date)}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {a.present
                      ? a.rate != null && a.quantity != null
                        ? `Piece: ${a.quantity} × ₹${a.rate}`
                        : a.dailyRateOverride != null
                          ? `₹${a.dailyRateOverride} today`
                          : "Regular rate"
                      : "Absent"}
                    {a.notes ? ` · ${a.notes}` : ""}
                  </div>
                </div>
                {a.present && (
                  <div className="text-sm font-medium">{formatINR(Number(earned) || 0)}</div>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={async () => {
                    if (!confirm(`Delete this attendance row?`)) return;
                    await fetch(`/api/attendance/${a.id}`, { method: "DELETE" });
                    globalMutate(`/api/workers/${id}`);
                  }}
                  aria-label="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
            );
          })}
          {data.attendance.length === 0 && (
            <div className="px-5 py-6 text-sm text-muted-foreground text-center">
              No attendance yet.
            </div>
          )}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold mb-2">Recent payments</h2>
        <div className="rounded-xl border bg-card divide-y">
          {data.payments.map((p) => (
            <div key={p.id} className="flex items-center gap-3 px-5 py-2.5">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{formatDate(p.paidAt)}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {p.isBonus ? "Bonus" : p.isAdvance ? "Advance" : "Wage"}
                  {p.notes ? ` · ${p.notes}` : ""}
                </div>
              </div>
              <div className="text-sm font-semibold">{formatINR(p.amount)}</div>
              <Button
                variant="ghost"
                size="icon"
                onClick={async () => {
                  if (!confirm(`Delete this payment?`)) return;
                  await fetch(`/api/wage-payments/${p.id}`, { method: "DELETE" });
                  globalMutate(`/api/workers/${id}`);
                  mutateBalances();
                }}
                aria-label="Delete"
              >
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </div>
          ))}
          {data.payments.length === 0 && (
            <div className="px-5 py-6 text-sm text-muted-foreground text-center">
              No payments yet.
            </div>
          )}
        </div>
      </section>

      <AttendanceDialog
        workerId={id ?? ""}
        defaultRate={data.worker.dailyRate}
        open={attendanceOpen}
        onClose={() => setAttendanceOpen(false)}
      />
      <PayDialog
        workerId={id ?? ""}
        workerName={data.worker.name}
        accounts={accounts}
        open={payOpen}
        onClose={() => setPayOpen(false)}
      />
      <SettleDialog
        settlement={settleOpen}
        accounts={accounts}
        onClose={() => setSettleOpen(null)}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone = "default",
  highlight,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "primary" | "destructive" | "muted";
  highlight?: boolean;
}) {
  const valueColor =
    tone === "primary"
      ? "text-primary"
      : tone === "destructive"
        ? "text-destructive"
        : tone === "muted"
          ? "text-muted-foreground"
          : "text-foreground";
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 ${highlight ? "text-2xl" : "text-lg"} font-semibold ${valueColor}`}>
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function AttendanceDialog({
  workerId,
  defaultRate,
  open,
  onClose,
}: {
  workerId: string;
  defaultRate: number | null;
  open: boolean;
  onClose: () => void;
}) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [date, setDate] = useState(today);
  const [present, setPresent] = useState(true);
  const [rateOverride, setRateOverride] = useState("");
  const [useOverride, setUseOverride] = useState(false);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- reset on open */
    setDate(today);
    setPresent(true);
    setRateOverride("");
    setUseOverride(false);
    setNotes("");
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, today]);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/attendance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workerId,
          date,
          present,
          dailyRateOverride: useOverride && rateOverride ? Number(rateOverride) : null,
          notes: notes.trim() || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) setError(body.error ?? "Failed");
      else {
        toast.success(present ? "Marked present" : "Marked absent");
        globalMutate(`/api/workers/${workerId}`);
        globalMutate("/api/workers");
        onClose();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark attendance</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs font-medium">Date</span>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <div className="flex gap-2">
            <Button
              type="button"
              variant={present ? "default" : "outline"}
              onClick={() => setPresent(true)}
            >
              Present
            </Button>
            <Button
              type="button"
              variant={!present ? "default" : "outline"}
              onClick={() => setPresent(false)}
            >
              Absent
            </Button>
          </div>
          {present && (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={useOverride}
                onChange={(e) => setUseOverride(e.target.checked)}
              />
              <span className="text-sm">Different rate today (default: ₹{defaultRate ?? 0})</span>
            </label>
          )}
          {useOverride && (
            <Input
              type="number"
              inputMode="decimal"
              value={rateOverride}
              onChange={(e) => setRateOverride(e.target.value)}
              placeholder="Today's rate (₹)"
            />
          )}
          <label className="block">
            <span className="text-xs font-medium">Notes (optional)</span>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PayDialog({
  workerId,
  workerName,
  accounts,
  open,
  onClose,
}: {
  workerId: string;
  workerName: string;
  accounts: Account[];
  open: boolean;
  onClose: () => void;
}) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState(today);
  const [accountId, setAccountId] = useState("");
  const [kind, setKind] = useState<"WAGE" | "ADVANCE" | "BONUS">("WAGE");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- reset on open */
    setAmount("");
    setPaidAt(today);
    setAccountId("");
    setKind("WAGE");
    setNotes("");
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, today]);

  async function submit() {
    setError(null);
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      setError("Enter an amount");
      return;
    }
    if (!accountId) {
      setError("Pick an account");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/wage-payments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workerId,
          amount: amt,
          paidAt,
          isBonus: kind === "BONUS",
          isAdvance: kind === "ADVANCE",
          notes: notes.trim() || undefined,
          accountId,
        }),
      });
      const body = await res.json();
      if (!res.ok) setError(body.error ?? "Failed");
      else {
        toast.success(`${kind === "BONUS" ? "Bonus" : kind === "ADVANCE" ? "Advance" : "Wage"} paid`);
        globalMutate(`/api/workers/${workerId}`);
        globalMutate("/api/workers");
        await mutateBalances();
        onClose();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pay {workerName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            {(["WAGE", "ADVANCE", "BONUS"] as const).map((k) => (
              <Button
                key={k}
                type="button"
                size="sm"
                variant={kind === k ? "default" : "outline"}
                onClick={() => setKind(k)}
              >
                {k}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {kind === "WAGE"
              ? "Regular wage — subtracts from owed balance."
              : kind === "ADVANCE"
                ? "Paid ahead of work — still subtracts from balance; worker may go negative."
                : "Bonus — creates an expense, doesn't touch the wage balance."}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium">Amount (₹)</span>
              <Input
                type="number"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                autoFocus
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium">Date</span>
              <Input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium">Pay from</span>
            <select
              className="w-full rounded border border-input bg-background px-2 py-2 text-sm mt-1"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              <option value="">— pick —</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.kind})
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium">Notes (optional)</span>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            Pay
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SettleDialog({
  settlement,
  accounts,
  onClose,
}: {
  settlement: Settlement | null;
  accounts: Account[];
  onClose: () => void;
}) {
  const [accountId, setAccountId] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!settlement) return;
    /* eslint-disable react-hooks/set-state-in-effect -- reset on open */
    setAccountId("");
    setNotes("");
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [settlement]);

  async function submit() {
    if (!settlement) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/wage-settlements/${settlement.id}/settle`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          paymentAccountId:
            settlement.amountDue > 0 ? accountId || undefined : undefined,
          notes: notes.trim() || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) setError(body.error ?? "Failed");
      else {
        toast.success("Settled");
        globalMutate((key) => typeof key === "string" && key.includes("/api/workers"));
        globalMutate("/api/wage-settlements");
        await mutateBalances();
        onClose();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={settlement !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Close out settlement</DialogTitle>
        </DialogHeader>
        {settlement && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Amount due: <strong>{formatINR(settlement.amountDue)}</strong>
            </p>
            {settlement.amountDue > 0 ? (
              <>
                <label className="block">
                  <span className="text-xs font-medium">Pay from</span>
                  <select
                    className="w-full rounded border border-input bg-background px-2 py-2 text-sm mt-1"
                    value={accountId}
                    onChange={(e) => setAccountId(e.target.value)}
                  >
                    <option value="">— don&apos;t pay now, mark settled —</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.kind})
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Picking an account auto-creates the wage payment (+ expense transaction) and
                    marks the settlement SETTLED.
                  </p>
                </label>
                <label className="block">
                  <span className="text-xs font-medium">Notes</span>
                  <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={200} />
                </label>
              </>
            ) : (
              <p className="text-sm">Nothing owed — this closes out the period.</p>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
