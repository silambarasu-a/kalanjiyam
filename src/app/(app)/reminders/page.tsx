"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { toast } from "sonner";
import { Bell, Clock, Check, X } from "lucide-react";
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
import { formatINR, formatDate, groupAccountOptions } from "@/lib/utils";

type Reminder = {
  id: string;
  kind:
    | "SIP_BUY"
    | "FD_INTEREST"
    | "INSURANCE_PREMIUM"
    | "LEASE_PAYMENT"
    | "LOAN_EMI"
    | "CARD_STATEMENT";
  dueDate: string;
  amount: number | null;
  status: "UPCOMING" | "CONFIRMED" | "SKIPPED" | "MISSED";
  investment: { id: string; name: string; kind: string; premiumAmount: number | null } | null;
};
type Account = {
  id: string;
  name: string;
  kind: string;
  balance: number;
  availableLimit: number | null;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function RemindersPage() {
  const { data, isLoading } = useSWR<{ reminders: Reminder[] }>(
    "/api/reminders?status=UPCOMING",
    fetcher
  );
  const [confirmRow, setConfirmRow] = useState<Reminder | null>(null);

  const reminders = data?.reminders ?? [];
  const now = new Date();
  const overdue = reminders.filter((r) => new Date(r.dueDate) < now);
  const upcoming = reminders.filter((r) => new Date(r.dueDate) >= now);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Bell className="h-5 w-5 text-primary" /> Reminders
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Upcoming SIP buys, insurance premiums, FD maturity. Confirm each one to record the
          matching transaction.
        </p>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {overdue.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-2 text-destructive">Overdue</h2>
          <div className="rounded-xl border bg-card divide-y">
            {overdue.map((r) => (
              <ReminderRow key={r.id} reminder={r} onConfirm={() => setConfirmRow(r)} />
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="text-sm font-semibold mb-2">Upcoming</h2>
        <div className="rounded-xl border bg-card divide-y">
          {upcoming.map((r) => (
            <ReminderRow key={r.id} reminder={r} onConfirm={() => setConfirmRow(r)} />
          ))}
          {upcoming.length === 0 && !isLoading && (
            <div className="px-5 py-8 text-sm text-muted-foreground text-center">
              Nothing upcoming. SIPs, insurance premiums, and FD maturities show here as they
              approach.
            </div>
          )}
        </div>
      </section>

      <ConfirmDialog reminder={confirmRow} onClose={() => setConfirmRow(null)} />
    </div>
  );
}

function ReminderRow({
  reminder,
  onConfirm,
}: {
  reminder: Reminder;
  onConfirm: () => void;
}) {
  const amount = reminder.amount ?? reminder.investment?.premiumAmount ?? null;
  const overdue = new Date(reminder.dueDate) < new Date();
  return (
    <div className="flex items-center gap-3 px-5 py-3">
      <Clock className={`h-4 w-4 shrink-0 ${overdue ? "text-destructive" : "text-primary"}`} />
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">
          {reminder.kind.replace(/_/g, " ")} · {reminder.investment?.name ?? "—"}
        </div>
        <div className="text-xs text-muted-foreground">
          Due {formatDate(reminder.dueDate)}
          {amount != null ? ` · ${formatINR(amount)}` : ""}
        </div>
      </div>
      <Button size="sm" variant="outline" onClick={onConfirm}>
        <Check className="h-3 w-3" /> Confirm
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={async () => {
          if (!confirm("Skip this reminder?")) return;
          await fetch(`/api/reminders/${reminder.id}/skip`, { method: "POST" });
          globalMutate("/api/reminders?status=UPCOMING");
          globalMutate("/api/dashboard/summary");
        }}
        aria-label="Skip"
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}

function ConfirmDialog({
  reminder,
  onClose,
}: {
  reminder: Reminder | null;
  onClose: () => void;
}) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const { data: accountsData } = useSWR<{ accounts: Account[] }>("/api/accounts", fetcher);
  const accounts = (accountsData?.accounts ?? []).filter((a) => a.kind !== "CARD");

  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!reminder) return;
    /* eslint-disable react-hooks/set-state-in-effect -- reset on open */
    setAccountId("");
    setAmount(
      reminder.amount != null
        ? String(reminder.amount)
        : reminder.investment?.premiumAmount != null
          ? String(reminder.investment.premiumAmount)
          : ""
    );
    setDate(today);
    setNotes("");
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [reminder, today]);

  async function submit() {
    if (!reminder) return;
    setError(null);
    if (!accountId) return setError("Pick an account");
    setSubmitting(true);
    try {
      const res = await fetch(`/api/reminders/${reminder.id}/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accountId,
          amount: amount ? Number(amount) : undefined,
          date,
          notes: notes.trim() || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) setError(body.error ?? "Failed");
      else {
        toast.success("Confirmed");
        globalMutate("/api/reminders?status=UPCOMING");
        globalMutate((k) => typeof k === "string" && k.startsWith("/api/investments"));
        globalMutate("/api/dashboard/summary");
        await mutateBalances();
        onClose();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={reminder !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Confirm {reminder?.kind.replace(/_/g, " ").toLowerCase()}
          </DialogTitle>
        </DialogHeader>
        {reminder && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {reminder.investment?.name} · due {formatDate(reminder.dueDate)}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-medium">Amount (₹)</span>
                <AmountInput value={amount} onChange={setAmount}
                  autoFocus
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium">Date</span>
                <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
            </div>
            <label className="block">
              <span className="text-xs font-medium">
                {reminder.kind === "FD_INTEREST" ? "Credit into" : "Pay from"}
              </span>
              <div className="mt-1">
                <NativeSelect
                  value={accountId}
                  onChange={setAccountId}
                  options={groupAccountOptions(
                    accounts,
                    reminder.kind === "FD_INTEREST" ? 0 : Number(amount) || 0,
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
            {submitting ? "Saving…" : "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
