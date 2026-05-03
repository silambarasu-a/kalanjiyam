"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import useSWR, { mutate as globalMutate } from "swr";
import { toast } from "sonner";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { mutateBalances } from "@/lib/mutate-balances";
import { formatINR, formatDate, groupAccountOptions } from "@/lib/utils";

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
type Transfer = {
  id: string;
  amount: number;
  date: string;
  notes: string | null;
  direction: "TO_CONTACT" | "FROM_CONTACT";
  account: { id: string; name: string } | null;
};
type SpentExpense = {
  id: string;
  amount: number;
  date: string;
  description: string;
  kind: "NONE" | "GIFT" | "RECOVERABLE";
  account: { id: string; name: string } | null;
};
type LinkedLoan = {
  id: string;
  kind: string;
  principal: number;
  outstanding: number;
  startedAt: string;
  nextDueDate: string | null;
  active: boolean;
  emiAmount: number | null;
  interestRate: number | null;
};
type Ledger = {
  member: { id: string; name: string };
  totals: {
    outstanding: number;
    settled: number;
    sentToContact: number;
    receivedFromContact: number;
    netTransferred: number;
    spentOnThem: number;
    loansOwed: number;
  };
  charges: Charge[];
  transfers: Transfer[];
  expenses: SpentExpense[];
  loans: LinkedLoan[];
};
type Account = {
  id: string;
  name: string;
  kind: string;
  balance: number;
  availableLimit: number | null;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function MemberLedgerDetail() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const { data } = useSWR<Ledger>(id ? `/api/contacts/${id}/ledger` : null, fetcher);
  const { data: accountsData } = useSWR<{ accounts: Account[] }>("/api/accounts", fetcher);
  const accounts = (accountsData?.accounts ?? []).filter((a) => a.kind !== "CARD");
  const [settleCharge, setSettleCharge] = useState<Charge | null>(null);
  const [transferOpen, setTransferOpen] = useState<"SEND" | "RECEIVE" | null>(null);

  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/contacts" className="text-xs text-muted-foreground">
          ← Contacts
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{data.member.name}</h1>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Outstanding" value={formatINR(data.totals.outstanding)} highlight />
        <Stat label="Settled to date" value={formatINR(data.totals.settled)} />
        <Stat
          label="Net transferred"
          value={formatINR(Math.abs(data.totals.netTransferred))}
          hint={
            data.totals.netTransferred > 0
              ? "you sent more"
              : data.totals.netTransferred < 0
                ? "they sent more"
                : "balanced"
          }
        />
        <Stat
          label={data.totals.loansOwed > 0 ? "You owe them" : "Spent on them"}
          value={formatINR(
            data.totals.loansOwed > 0
              ? data.totals.loansOwed
              : data.totals.spentOnThem,
          )}
          hint={
            data.totals.loansOwed > 0
              ? "open hand-loan principal"
              : "not recovered"
          }
        />
      </div>

      <Tabs defaultValue="charges" className="gap-3">
        <TabsList variant="line" className="border-b w-full justify-start gap-3 rounded-none">
          <TabsTrigger value="charges">
            Charges
            {data.charges.length > 0 && (
              <span className="ml-1 text-[10px] text-muted-foreground">
                ({data.charges.length})
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="transfers">
            Transfers
            {data.transfers.length > 0 && (
              <span className="ml-1 text-[10px] text-muted-foreground">
                ({data.transfers.length})
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="loans">
            Hand loans
            {data.loans.length > 0 && (
              <span className="ml-1 text-[10px] text-muted-foreground">
                ({data.loans.length})
              </span>
            )}
          </TabsTrigger>
          {data.expenses.length > 0 && (
            <TabsTrigger value="expenses">
              Spent on them
              <span className="ml-1 text-[10px] text-muted-foreground">
                ({data.expenses.length})
              </span>
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="charges">
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
        </TabsContent>

        <TabsContent value="transfers">
          <div className="flex items-center justify-end gap-2 mb-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setTransferOpen("SEND")}
              className="gap-1.5"
            >
              <ArrowUpRight className="h-3.5 w-3.5" /> Send
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setTransferOpen("RECEIVE")}
              className="gap-1.5"
            >
              <ArrowDownLeft className="h-3.5 w-3.5" /> Receive
            </Button>
            {data.transfers.length > 0 && (
              <Link
                href={`/transfers?contact=${id}`}
                className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground self-center px-2"
              >
                View all
              </Link>
            )}
          </div>
          <div className="rounded-lg border bg-card divide-y">
            {data.transfers.map((t) => {
              const out = t.direction === "TO_CONTACT";
              return (
                <div key={t.id} className="flex items-center gap-3 px-5 py-2.5">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{formatDate(t.date)}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {out ? "You sent" : "They sent"}
                      {t.account ? ` · ${t.account.name}` : ""}
                      {t.notes ? ` · ${t.notes}` : ""}
                    </div>
                  </div>
                  <div
                    className={`text-sm font-semibold tabular-nums ${
                      out
                        ? "text-destructive"
                        : "text-emerald-700 dark:text-emerald-400"
                    }`}
                  >
                    {out ? "−" : "+"}
                    {formatINR(t.amount)}
                  </div>
                </div>
              );
            })}
            {data.transfers.length === 0 && (
              <div className="px-5 py-6 text-sm text-muted-foreground text-center">
                No transfers with this contact yet.
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="loans">
          <div className="flex items-center justify-end mb-2">
            <Link
              href="/loans/hand"
              className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground self-center px-2"
            >
              Manage hand loans
            </Link>
          </div>
          <div className="rounded-lg border bg-card divide-y">
            {data.loans.map((l) => {
              const paid = Math.max(0, l.principal - l.outstanding);
              const pct =
                l.principal > 0 ? Math.min(100, (paid / l.principal) * 100) : 0;
              return (
                <div key={l.id} className="px-5 py-3">
                  <div className="flex items-center gap-3">
                    <Link
                      href={`/loans/${l.id}`}
                      className="flex-1 min-w-0 -mx-5 px-5 py-1 rounded-md hover:bg-accent/40 transition"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{l.kind}</span>
                        {!l.active && (
                          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                            cleared
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Started {formatDate(l.startedAt)}
                        {l.interestRate != null && l.interestRate > 0
                          ? ` · ${l.interestRate}% p.a.`
                          : " · interest-free"}
                        {l.nextDueDate && l.active
                          ? ` · next due ${formatDate(l.nextDueDate)}`
                          : ""}
                      </div>
                    </Link>
                    <div className="text-right">
                      <div className="text-sm font-semibold tabular-nums">
                        {formatINR(l.outstanding)}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        of {formatINR(l.principal)}
                      </div>
                    </div>
                    {l.active && l.outstanding > 0 && (
                      <Link
                        href={`/loans/${l.id}?pay=1`}
                        className={buttonVariants({
                          size: "sm",
                          variant: "outline",
                        })}
                      >
                        Pay
                      </Link>
                    )}
                  </div>
                  {l.principal > 0 && (
                    <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full bg-primary transition-[width]"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
            {data.loans.length === 0 && (
              <div className="px-5 py-8 text-sm text-muted-foreground text-center">
                No hand loans with this contact yet.{" "}
                <Link
                  href="/loans/hand"
                  className="underline text-foreground"
                >
                  Add one
                </Link>{" "}
                if you&apos;ve borrowed from them.
              </div>
            )}
          </div>
        </TabsContent>

        {data.expenses.length > 0 && (
          <TabsContent value="expenses">
            <p className="text-xs text-muted-foreground mb-2">
              Spent on this contact without marking as recoverable. Informational
              only — not in Outstanding.
            </p>
            <div className="rounded-lg border bg-card divide-y">
              {data.expenses.map((e) => (
                <div key={e.id} className="flex items-center gap-3 px-5 py-2.5">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{e.description}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {formatDate(e.date)}
                      {e.account ? ` · ${e.account.name}` : ""}
                      {e.kind === "GIFT" ? " · Gift" : ""}
                    </div>
                  </div>
                  <div className="text-sm font-semibold tabular-nums">
                    {formatINR(e.amount)}
                  </div>
                </div>
              ))}
            </div>
          </TabsContent>
        )}
      </Tabs>

      <TransferDialog
        contactId={id ?? ""}
        contactName={data.member.name}
        direction={transferOpen}
        accounts={accounts}
        onClose={() => setTransferOpen(null)}
      />

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
  hint,
  highlight,
}: {
  label: string;
  value: string;
  hint?: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 font-semibold ${highlight ? "text-2xl" : "text-lg"}`}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
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
            <div className="mt-1">
              <NativeSelect
                value={accountId}
                onChange={setAccountId}
                placeholder="— don't create income transaction —"
                options={groupAccountOptions(accounts, 0)}
              />
            </div>
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

function TransferDialog({
  contactId,
  contactName,
  direction,
  accounts,
  onClose,
}: {
  contactId: string;
  contactName: string;
  direction: "SEND" | "RECEIVE" | null;
  accounts: Account[];
  onClose: () => void;
}) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [accountId, setAccountId] = useState("");
  const [notes, setNotes] = useState("");
  const [expectBack, setExpectBack] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!direction) return;
    /* eslint-disable react-hooks/set-state-in-effect -- reset on dialog open */
    setAmount("");
    setDate(today);
    setAccountId("");
    setNotes("");
    setExpectBack(false);
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [direction, today]);

  async function submit() {
    if (!direction) return;
    setError(null);
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      setError("Enter an amount");
      return;
    }
    if (!accountId) {
      setError(direction === "SEND" ? "Pick an account to send from" : "Pick the receiving account");
      return;
    }
    const body =
      direction === "SEND"
        ? {
            fromAccountId: accountId,
            toContactId: contactId,
            amount: amt,
            date,
            notes: notes.trim() || undefined,
            expectBack,
          }
        : { fromContactId: contactId, toAccountId: accountId, amount: amt, date, notes: notes.trim() || undefined };
    setSubmitting(true);
    try {
      const res = await fetch("/api/transfers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const respBody = await res.json();
      if (!res.ok) setError(respBody.error ?? "Failed");
      else {
        toast.success(direction === "SEND" ? "Transfer sent" : "Transfer received");
        globalMutate(`/api/contacts/${contactId}/ledger`);
        await mutateBalances();
        onClose();
      }
    } finally {
      setSubmitting(false);
    }
  }

  const verb = direction === "SEND" ? "Send to" : "Receive from";
  const accountLabel = direction === "SEND" ? "Send from" : "Receive into";

  return (
    <Dialog open={direction !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {verb} {contactName}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium">Amount (₹)</span>
              <AmountInput value={amount} onChange={setAmount} autoFocus />
            </label>
            <label className="block">
              <span className="text-xs font-medium">Date</span>
              <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium">{accountLabel}</span>
            <div className="mt-1">
              <NativeSelect
                value={accountId}
                onChange={setAccountId}
                options={groupAccountOptions(accounts, Number(amount) || 0)}
              />
            </div>
          </label>
          {direction === "SEND" && (
            <label className="flex items-start gap-2.5 cursor-pointer rounded-md border bg-card p-3">
              <input
                type="checkbox"
                checked={expectBack}
                onChange={(e) => setExpectBack(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-primary"
              />
              <div className="space-y-0.5">
                <span className="text-sm font-medium block">
                  Expect this back from {contactName}
                </span>
                <span className="text-xs text-muted-foreground">
                  {expectBack
                    ? "Adds to their Outstanding — settle later from this page."
                    : "Just a transfer, no balance impact."}
                </span>
              </div>
            </label>
          )}
          <label className="block">
            <span className="text-xs font-medium">Notes (optional)</span>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "Saving…" : "Record transfer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
