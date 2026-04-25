"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR, { mutate as globalMutate } from "swr";
import { toast } from "sonner";
import { CalendarCheck, CalendarX, Clock, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { AmountInput } from "@/components/ui/amount-input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { mutateBalances } from "@/lib/mutate-balances";
import { formatINR, formatDate, buildAccountOption } from "@/lib/utils";

type Lease = {
  id: string;
  direction: "LEASED_OUT" | "LEASED_IN";
  amount: number;
  frequency: string;
  startDate: string;
  endDate: string;
  active: boolean;
  notes: string | null;
  lessor: { id: string | null; name: string } | null;
  lessee: { id: string | null; name: string } | null;
  assetType: "CROP_BATCH" | "LIVESTOCK_BATCH";
  cropBatch: { id: string; name: string; crop: { id: string; name: string } } | null;
  livestockBatch: { id: string; name: string; livestock: { id: string; name: string } } | null;
};

type ScheduleRow = {
  id: string;
  dueDate: string;
  amount: number;
  status: "UPCOMING" | "CONFIRMED" | "SKIPPED" | "MISSED";
  confirmedTxn: { id: string; description: string; date: string } | null;
};

type Account = {
  id: string;
  name: string;
  kind: string;
  balance: number;
  availableLimit: number | null;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function LeaseDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const { data } = useSWR<{ lease: Lease; schedule: ScheduleRow[] }>(
    id ? `/api/leases/${id}` : null,
    fetcher
  );
  const { data: accountsData } = useSWR<{ accounts: Account[] }>("/api/accounts", fetcher);
  const accounts = (accountsData?.accounts ?? []).filter((a) => a.kind !== "CARD");

  const [confirmRow, setConfirmRow] = useState<ScheduleRow | null>(null);

  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const { lease, schedule } = data;

  const paid = schedule.filter((s) => s.status === "CONFIRMED").reduce((s, r) => s + r.amount, 0);
  const outstanding = schedule
    .filter((s) => s.status === "UPCOMING")
    .reduce((s, r) => s + r.amount, 0);

  const assetLabel =
    lease.assetType === "CROP_BATCH"
      ? `${lease.cropBatch?.crop.name} · ${lease.cropBatch?.name}`
      : `${lease.livestockBatch?.livestock.name} · ${lease.livestockBatch?.name}`;
  const counterparty =
    lease.direction === "LEASED_OUT" ? lease.lessee : lease.lessor;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/leases" className="text-xs text-muted-foreground">
          ← Leases
        </Link>
        <div className="mt-1 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{assetLabel}</h1>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {lease.direction === "LEASED_OUT" ? "Leased out to" : "Leased in from"}{" "}
              <strong>{counterparty?.name ?? "—"}</strong> · {lease.frequency.replace("_", " ").toLowerCase()}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {formatDate(lease.startDate)} → {formatDate(lease.endDate)}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={async () => {
              if (!confirm(`Delete this lease?`)) return;
              const res = await fetch(`/api/leases/${id}`, { method: "DELETE" });
              if (!res.ok) {
                const body = await res.json();
                toast.error(body.error ?? "Failed");
              } else {
                window.location.href = "/leases";
              }
            }}
            aria-label="Delete"
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Total lease" value={formatINR(lease.amount)} />
        <Stat label="Paid" value={formatINR(paid)} tone="muted" />
        <Stat label="Outstanding" value={formatINR(outstanding)} tone="primary" highlight />
        <Stat label="Installments" value={`${schedule.length}`} />
      </div>

      <section>
        <h2 className="text-sm font-semibold mb-2">Payment schedule</h2>
        <div className="rounded-xl border bg-card divide-y">
          {schedule.map((s) => {
            const icon =
              s.status === "CONFIRMED"
                ? CalendarCheck
                : s.status === "SKIPPED" || s.status === "MISSED"
                  ? CalendarX
                  : Clock;
            const Icon = icon;
            const tone =
              s.status === "CONFIRMED"
                ? "text-primary"
                : s.status === "SKIPPED" || s.status === "MISSED"
                  ? "text-muted-foreground"
                  : "text-foreground";
            return (
              <div key={s.id} className="flex items-center gap-3 px-5 py-3">
                <Icon className={`h-4 w-4 shrink-0 ${tone}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{formatDate(s.dueDate)}</div>
                  <div className="text-xs text-muted-foreground">
                    {s.status}
                    {s.confirmedTxn
                      ? ` · ${s.confirmedTxn.description.slice(0, 60)}`
                      : ""}
                  </div>
                </div>
                <div className="text-sm font-semibold">{formatINR(s.amount)}</div>
                {s.status === "UPCOMING" && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => setConfirmRow(s)}>
                      Confirm
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        if (!confirm(`Skip this payment?`)) return;
                        await fetch(
                          `/api/leases/${id}/schedule/${s.id}/skip`,
                          { method: "POST" }
                        );
                        globalMutate(`/api/leases/${id}`);
                        globalMutate("/api/leases");
                      }}
                    >
                      Skip
                    </Button>
                  </>
                )}
              </div>
            );
          })}
          {schedule.length === 0 && (
            <div className="px-5 py-8 text-sm text-muted-foreground text-center">
              No schedule rows.
            </div>
          )}
        </div>
      </section>

      <ConfirmPaymentDialog
        leaseId={id ?? ""}
        direction={lease.direction}
        row={confirmRow}
        accounts={accounts}
        onClose={() => setConfirmRow(null)}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "default",
  highlight,
}: {
  label: string;
  value: string;
  tone?: "default" | "primary" | "muted";
  highlight?: boolean;
}) {
  const valueColor =
    tone === "primary"
      ? "text-primary"
      : tone === "muted"
        ? "text-muted-foreground"
        : "text-foreground";
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={`mt-1 ${highlight ? "text-2xl" : "text-lg"} font-semibold ${valueColor}`}
      >
        {value}
      </div>
    </div>
  );
}

function ConfirmPaymentDialog({
  leaseId,
  direction,
  row,
  accounts,
  onClose,
}: {
  leaseId: string;
  direction: "LEASED_OUT" | "LEASED_IN";
  row: ScheduleRow | null;
  accounts: Account[];
  onClose: () => void;
}) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [accountId, setAccountId] = useState("");
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!row) return;
    /* eslint-disable react-hooks/set-state-in-effect -- reset on open */
    setAccountId("");
    setDate(today);
    setAmount(String(row.amount));
    setNotes("");
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [row, today]);

  async function submit() {
    if (!row) return;
    setError(null);
    if (!accountId) return setError("Pick an account");
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/leases/${leaseId}/schedule/${row.id}/confirm`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            accountId,
            date,
            amount: amount ? Number(amount) : undefined,
            notes: notes.trim() || undefined,
          }),
        }
      );
      const body = await res.json();
      if (!res.ok) setError(body.error ?? "Failed");
      else {
        toast.success(direction === "LEASED_OUT" ? "Payment received" : "Payment made");
        globalMutate(`/api/leases/${leaseId}`);
        globalMutate("/api/leases");
        await mutateBalances();
        onClose();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={row !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {direction === "LEASED_OUT" ? "Record received payment" : "Record lease payment"}
          </DialogTitle>
        </DialogHeader>
        {row && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Due {formatDate(row.dueDate)}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-medium">Amount (₹)</span>
                <AmountInput value={amount} onChange={setAmount}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium">Date</span>
                <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
            </div>
            <label className="block">
              <span className="text-xs font-medium">
                {direction === "LEASED_OUT" ? "Received into" : "Paid from"}
              </span>
              <div className="mt-1">
                <NativeSelect
                  value={accountId}
                  onChange={setAccountId}
                  options={accounts.map((a) =>
                    buildAccountOption(a, direction === "LEASED_IN" ? Number(amount) || 0 : 0),
                  )}
                />
              </div>
            </label>
            <label className="block">
              <span className="text-xs font-medium">Notes</span>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={200} />
            </label>
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
