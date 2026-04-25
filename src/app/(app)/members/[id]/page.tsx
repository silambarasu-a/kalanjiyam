"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import useSWR from "swr";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { AmountInput } from "@/components/ui/amount-input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { mutateBalances } from "@/lib/mutate-balances";
import { formatINR, formatDate } from "@/lib/utils";

type Settlement = { id: string; amount: number; paidAt: string; notes: string | null };
type Charge = {
  id: string;
  amount: number;
  settledAmount: number;
  status: "OUTSTANDING" | "PARTIAL" | "SETTLED" | "WRITTEN_OFF";
  notes: string | null;
  createdAt: string;
  origin: { id: string; description: string; date: string } | null;
  settlements: Settlement[];
};
type Ledger = {
  member: { id: string; name: string };
  totals: { outstanding: number; settled: number };
  charges: Charge[];
};
type Account = { id: string; name: string; kind: string };

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function MemberLedgerDetail() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const { data } = useSWR<Ledger>(id ? `/api/family/${id}/ledger` : null, fetcher);
  const { data: accountsData } = useSWR<{ accounts: Account[] }>("/api/accounts", fetcher);
  const accounts = (accountsData?.accounts ?? []).filter((a) => a.kind !== "CARD");
  const [settleCharge, setSettleCharge] = useState<Charge | null>(null);

  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/members" className="text-xs text-muted-foreground">
          ← Member ledger
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{data.member.name}</h1>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Outstanding" value={formatINR(data.totals.outstanding)} highlight />
        <Stat label="Settled to date" value={formatINR(data.totals.settled)} />
        <Stat label="Charges" value={String(data.charges.length)} />
      </div>

      <div className="rounded-lg border bg-card divide-y">
        {data.charges.map((c) => {
          const remaining = c.amount - c.settledAmount;
          return (
            <div key={c.id} className="px-5 py-3">
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">
                    {c.origin?.description ?? "Charge"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {c.origin ? formatDate(c.origin.date) : formatDate(c.createdAt)} · {c.status}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-semibold">{formatINR(c.amount)}</div>
                  {c.settledAmount > 0 && (
                    <div className="text-xs text-muted-foreground">
                      Settled: {formatINR(c.settledAmount)}
                    </div>
                  )}
                </div>
                {c.status !== "SETTLED" && c.status !== "WRITTEN_OFF" && (
                  <Button size="sm" variant="outline" onClick={() => setSettleCharge(c)}>
                    Settle
                  </Button>
                )}
              </div>
              {c.settlements.length > 0 && (
                <ul className="mt-2 ml-1 border-l pl-3 space-y-1">
                  {c.settlements.map((s) => (
                    <li key={s.id} className="text-xs text-muted-foreground">
                      {formatDate(s.paidAt)} · {formatINR(s.amount)}
                      {s.notes ? ` · ${s.notes}` : ""}
                    </li>
                  ))}
                </ul>
              )}
              {remaining > 0 && (
                <div className="mt-1 text-xs text-muted-foreground">
                  Remaining: {formatINR(remaining)}
                </div>
              )}
            </div>
          );
        })}
        {data.charges.length === 0 && (
          <div className="px-5 py-8 text-sm text-muted-foreground text-center">
            No charges yet.
          </div>
        )}
      </div>

      <SettleDialog
        charge={settleCharge}
        accounts={accounts}
        onClose={() => setSettleCharge(null)}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 font-semibold ${highlight ? "text-2xl" : "text-lg"}`}>{value}</div>
    </div>
  );
}

function SettleDialog({
  charge,
  accounts,
  onClose,
}: {
  charge: Charge | null;
  accounts: Account[];
  onClose: () => void;
}) {
  const remaining = charge ? charge.amount - charge.settledAmount : 0;
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState(today);
  const [accountId, setAccountId] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!charge) return;
    /* eslint-disable react-hooks/set-state-in-effect -- reset on dialog open */
    setAmount(remaining.toFixed(2));
    setPaidAt(today);
    setAccountId("");
    setNotes("");
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [charge, remaining, today]);

  async function submit() {
    if (!charge) return;
    setError(null);
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      setError("Enter an amount");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/member-charges/${charge.id}/settle`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amount: amt,
          paidAt,
          notes: notes.trim() || undefined,
          accountId: accountId || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) setError(body.error ?? "Failed");
      else {
        toast.success("Settlement recorded");
        await mutateBalances();
        onClose();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={charge !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record settlement</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Outstanding: {formatINR(remaining)}.
        </p>
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs font-medium">Amount (₹)</span>
            <AmountInput value={amount} onChange={setAmount}
              autoFocus
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium">Paid on</span>
            <DateInput value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-xs font-medium">Received into account (optional)</span>
            <select
              className="w-full rounded border border-input bg-background px-2 py-2 text-sm mt-1"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              <option value="">— don&apos;t create income transaction —</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              Pick to auto-create an INCOME transaction when this member pays you back.
            </p>
          </label>
          <label className="block">
            <span className="text-xs font-medium">Notes</span>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={200} />
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "Saving…" : "Record"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
