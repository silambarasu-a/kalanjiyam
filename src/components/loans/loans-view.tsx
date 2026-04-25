"use client";

import { useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { toast } from "sonner";
import { Plus, Trash2, Landmark, Banknote, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AmountInput } from "@/components/ui/amount-input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LoanForm } from "@/components/loans/loan-form";
import { mutateBalances } from "@/lib/mutate-balances";
import { formatINR, formatDate } from "@/lib/utils";
import { MoneyValue, ToneBadge } from "@/components/ui/money-tone";

type Loan = {
  id: string;
  kind: string;
  source: "BANK" | "HAND_FORMAL" | "CARD_EMI";
  lender: string;
  principal: number;
  outstanding: number;
  interestRate: number | null;
  emiAmount: number | null;
  tenure: number | null;
  startedAt: string;
  nextDueDate: string | null;
  active: boolean;
  card: { id: string; name: string } | null;
  account: { id: string; name: string } | null;
};

type Account = { id: string; name: string; kind: string };

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const SOURCE_META = {
  BANK: { label: "Bank loans", Icon: Landmark, emptyHint: "Add your first bank loan." },
  HAND_FORMAL: {
    label: "Hand loans (formal)",
    Icon: Banknote,
    emptyHint: "Formal hand loans with interest and EMI schedule.",
  },
  CARD_EMI: {
    label: "Card EMI",
    Icon: Receipt,
    emptyHint:
      "Convert a credit card purchase to EMI. Principal reduces the card's available limit.",
  },
} as const;

export function LoansView({ source }: { source: "BANK" | "HAND_FORMAL" | "CARD_EMI" }) {
  const meta = SOURCE_META[source];
  const { data, isLoading } = useSWR<{ loans: Loan[] }>(
    `/api/loans?source=${source}`,
    fetcher
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [payLoan, setPayLoan] = useState<Loan | null>(null);

  const activeOutstanding = (data?.loans ?? [])
    .filter((l) => l.active)
    .reduce((s, l) => s + l.outstanding, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{meta.label}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {activeOutstanding > 0
              ? `${formatINR(activeOutstanding)} outstanding across active loans`
              : "No outstanding balance"}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          {source === "CARD_EMI" ? "Convert to EMI" : "New loan"}
        </Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {(data?.loans ?? []).map((l) => {
          const paid = l.principal - l.outstanding;
          const pct = l.principal > 0 ? Math.min(100, (paid / l.principal) * 100) : 0;
          return (
            <div key={l.id} className="rounded-xl border bg-card p-5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <meta.Icon className="h-4 w-4 text-primary shrink-0" />
                    <h3 className="truncate font-semibold">{l.lender}</h3>
                    {!l.active && (
                      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                        closed
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {l.kind} · started {formatDate(l.startedAt)}
                    {l.card ? ` · on ${l.card.name}` : ""}
                    {l.tenure ? ` · ${l.tenure}mo` : ""}
                  </div>
                </div>
                <div className="flex gap-1">
                  {l.active && (
                    <Button size="sm" variant="outline" onClick={() => setPayLoan(l)}>
                      Pay
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={async () => {
                      if (!confirm(`Delete loan "${l.lender}"?`)) return;
                      const res = await fetch(`/api/loans/${l.id}`, { method: "DELETE" });
                      if (!res.ok) {
                        const body = await res.json();
                        alert(body.error ?? "Failed");
                      }
                      globalMutate(`/api/loans?source=${source}`);
                    }}
                    aria-label="Delete"
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Outstanding</span>
                    <ToneBadge
                      tone={l.outstanding > 0 ? "outstanding" : "settled"}
                      label={l.outstanding > 0 ? "Active" : "Cleared"}
                    />
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    {formatINR(paid)} paid of {formatINR(l.principal)}
                  </span>
                </div>
                <MoneyValue
                  tone={l.outstanding > 0 ? "outstanding" : "settled"}
                  value={formatINR(l.outstanding)}
                  className="text-2xl font-semibold mt-1"
                  icon={false}
                />
                <div className="mt-2 h-1.5 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
              {l.emiAmount != null && (
                <div className="text-xs text-muted-foreground">
                  EMI {formatINR(l.emiAmount)}
                  {l.interestRate ? ` · ${l.interestRate}% p.a.` : ""}
                </div>
              )}
            </div>
          );
        })}
        {(data?.loans ?? []).length === 0 && !isLoading && (
          <div className="col-span-full rounded-xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
            {meta.emptyHint}
          </div>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={(o) => !o && setCreateOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {source === "CARD_EMI" ? "Convert a purchase to EMI" : "New loan"}
            </DialogTitle>
          </DialogHeader>
          <LoanForm
            source={source}
            onSaved={() => setCreateOpen(false)}
            onCancel={() => setCreateOpen(false)}
          />
        </DialogContent>
      </Dialog>

      <PayDialog
        loan={payLoan}
        source={source}
        onClose={() => setPayLoan(null)}
      />
    </div>
  );
}

function PayDialog({
  loan,
  source,
  onClose,
}: {
  loan: Loan | null;
  source: "BANK" | "HAND_FORMAL" | "CARD_EMI";
  onClose: () => void;
}) {
  const { data: accountsData } = useSWR<{ accounts: Account[] }>("/api/accounts", fetcher);
  const accounts = (accountsData?.accounts ?? []).filter((a) => a.kind !== "CARD");

  const today = new Date().toISOString().slice(0, 10);
  const [amount, setAmount] = useState("");
  const [principalPortion, setPrincipalPortion] = useState("");
  const [interestPortion, setInterestPortion] = useState("");
  const [gstPortion, setGstPortion] = useState("");
  const [paidAt, setPaidAt] = useState(today);
  const [accountId, setAccountId] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset on loan change
  if (loan && amount === "" && loan.emiAmount != null) {
    // One-time init; subsequent edits keep user input
  }

  async function submit() {
    if (!loan) return;
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
      const res = await fetch(`/api/loans/${loan.id}/pay`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amount: amt,
          paidAt,
          accountId,
          principalPortion: principalPortion ? Number(principalPortion) : null,
          interestPortion: interestPortion ? Number(interestPortion) : null,
          gstPortion: gstPortion ? Number(gstPortion) : null,
          notes: notes.trim() || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) setError(body.error ?? "Failed");
      else {
        toast.success("EMI paid");
        globalMutate(`/api/loans?source=${source}`);
        await mutateBalances();
        onClose();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={loan !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record EMI payment</DialogTitle>
        </DialogHeader>
        {loan && (
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              Outstanding on <strong>{loan.lender}</strong>: {formatINR(loan.outstanding)}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-medium">Total paid (₹)</span>
                <AmountInput value={amount} onChange={setAmount}
                  placeholder={loan.emiAmount != null ? String(loan.emiAmount) : "EMI amount"}
                  autoFocus
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium">Date</span>
                <Input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
              </label>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <label className="block">
                <span className="text-xs font-medium">Principal</span>
                <AmountInput value={principalPortion} onChange={setPrincipalPortion}
                  placeholder="Optional"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium">Interest</span>
                <AmountInput value={interestPortion} onChange={setInterestPortion}
                  placeholder="Optional"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium">GST</span>
                <AmountInput value={gstPortion} onChange={setGstPortion}
                  placeholder="Optional"
                />
              </label>
            </div>
            <p className="text-xs text-muted-foreground">
              If you split the payment, <strong>outstanding drops by the principal portion only</strong>.
              If you leave it blank, the full amount reduces outstanding.
            </p>
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
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium">Notes</span>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={200}
              />
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
