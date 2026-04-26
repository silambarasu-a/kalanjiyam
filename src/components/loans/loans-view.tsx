"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import useSWR, { mutate as globalMutate } from "swr";
import { toast } from "sonner";
import { Plus, Trash2, Landmark, Banknote, Receipt } from "lucide-react";
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
import { LoanForm, type LoanFormHandle } from "@/components/loans/loan-form";
import { mutateBalances } from "@/lib/mutate-balances";
import { formatINR, formatDate, buildAccountOption } from "@/lib/utils";
import { splitPayment, cyclesPerYear, type LoanFrequency } from "@/lib/loan-math";
import { MoneyValue, ToneBadge } from "@/components/ui/money-tone";

type GoldItem = {
  id: string;
  name: string;
  quantity: number;
  weightGrams: number;
  purity: number | null;
  notes: string | null;
};

type Loan = {
  id: string;
  kind: string;
  source: "BANK" | "HAND_FORMAL" | "CARD_EMI";
  lender: string;
  principal: number;
  outstanding: number;
  interestRate: number | null;
  gstOnInterest: number | null;
  emiAmount: number | null;
  tenure: number | null;
  frequency: LoanFrequency | null;
  startedAt: string;
  nextDueDate: string | null;
  active: boolean;
  card: { id: string; name: string } | null;
  account: { id: string; name: string } | null;
  goldItems?: GoldItem[];
};

const FREQUENCY_LABEL: Record<LoanFrequency, { tenureUnit: string; emi: string }> = {
  MONTHLY: { tenureUnit: "mo", emi: "monthly" },
  QUARTERLY: { tenureUnit: "qtr", emi: "quarterly" },
  HALF_YEARLY: { tenureUnit: "half-yr", emi: "half-yearly" },
  YEARLY: { tenureUnit: "yr", emi: "yearly" },
};

type Account = {
  id: string;
  name: string;
  kind: string;
  balance: number;
  availableLimit: number | null;
};

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
  const loanFormRef = useRef<LoanFormHandle>(null);
  const [loanFormBusy, setLoanFormBusy] = useState(false);

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
            <div
              key={l.id}
              className="relative rounded-xl border bg-card p-5 space-y-3 transition-colors hover:bg-muted/30"
            >
              {/* Stretched link covers the full card. Action buttons opt back
                  in via relative+z-10 so they stay clickable. */}
              <Link
                href={`/loans/${l.id}`}
                aria-label={`View ${l.lender}`}
                className="absolute inset-0 z-0 rounded-xl focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
              />
              <div className="relative flex items-start justify-between gap-3">
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
                    {l.tenure
                      ? ` · ${l.tenure}${FREQUENCY_LABEL[l.frequency ?? "MONTHLY"].tenureUnit}`
                      : ""}
                  </div>
                  {l.kind === "GOLD" && l.goldItems && l.goldItems.length > 0 && (
                    <div className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
                      {l.goldItems.reduce((s, g) => s + g.quantity, 0)} gold item(s) ·{" "}
                      {l.goldItems
                        .reduce((s, g) => s + g.weightGrams * g.quantity, 0)
                        .toFixed(3)}{" "}
                      g pledged
                    </div>
                  )}
                </div>
                <div className="relative z-10 flex gap-1">
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
                  {FREQUENCY_LABEL[l.frequency ?? "MONTHLY"].emi[0].toUpperCase() +
                    FREQUENCY_LABEL[l.frequency ?? "MONTHLY"].emi.slice(1)}{" "}
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
        <DialogContent className="w-[min(36rem,calc(100%-2rem))]">
          <DialogHeader>
            <DialogTitle>
              {source === "CARD_EMI" ? "Convert a purchase to EMI" : "New loan"}
            </DialogTitle>
          </DialogHeader>
          <LoanForm
            ref={loanFormRef}
            source={source}
            onSaved={() => setCreateOpen(false)}
            onSubmittingChange={setLoanFormBusy}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => loanFormRef.current?.submit()} disabled={loanFormBusy}>
              {loanFormBusy ? "Saving…" : "Create"}
            </Button>
          </DialogFooter>
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
  const [overrideSplit, setOverrideSplit] = useState(false);
  const [principalPortion, setPrincipalPortion] = useState("");
  const [interestPortion, setInterestPortion] = useState("");
  const [gstPortion, setGstPortion] = useState("");
  const [paidAt, setPaidAt] = useState(today);
  const [accountId, setAccountId] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pre-fill the amount when the dialog opens so a one-tap "Confirm"
  // posts the standard EMI. Capped at outstanding so the last (smaller)
  // EMI doesn't overpay.
  const loanId = loan?.id;
  useEffect(() => {
    if (!loanId || !loan) return;
    const suggested =
      loan.emiAmount != null
        ? Math.min(loan.emiAmount, loan.outstanding)
        : loan.outstanding;
    setAmount(suggested > 0 ? String(suggested) : "");
    setOverrideSplit(false);
    setPrincipalPortion("");
    setInterestPortion("");
    setGstPortion("");
    setNotes("");
    setError(null);
    setPaidAt(today);
    // Re-run only when a different loan is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loanId]);

  // Suggested split using standard reducing-balance: interest = outstanding
  // × periodicRate, GST (card EMI) on top, remainder is principal.
  const amt = Number(amount) || (loan?.emiAmount ?? 0);
  const freq: LoanFrequency = loan?.frequency ?? "MONTHLY";
  const suggestion =
    loan && amt > 0
      ? splitPayment(
          loan.outstanding,
          loan.interestRate ?? 0,
          Math.min(loan.emiAmount ?? amt, amt),
          freq,
          loan.gstOnInterest ?? null
        )
      : { interest: 0, principal: 0, gst: 0 };
  const suggestedPrincipal = Math.max(
    0,
    Math.round((amt - suggestion.interest - suggestion.gst) * 100) / 100
  );

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
          // Send overrides only when the user explicitly opted in. Otherwise
          // the server auto-splits using the standard reducing-balance rule.
          principalPortion:
            overrideSplit && principalPortion ? Number(principalPortion) : null,
          interestPortion:
            overrideSplit && interestPortion ? Number(interestPortion) : null,
          gstPortion:
            overrideSplit && gstPortion ? Number(gstPortion) : null,
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
      <DialogContent className="w-[min(36rem,calc(100%-2rem))]">
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
                <DateInput value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
              </label>
            </div>
            {amt > 0 && (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs space-y-1.5">
                <div className="flex items-center justify-between font-medium text-foreground">
                  <span>Auto-split (reducing balance)</span>
                  <button
                    type="button"
                    className="text-[11px] font-normal underline text-muted-foreground"
                    onClick={() => setOverrideSplit((v) => !v)}
                  >
                    {overrideSplit ? "Use auto-split" : "Override"}
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Principal</span>
                  <span className="tabular-nums">{formatINR(suggestedPrincipal)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Interest</span>
                  <span className="tabular-nums">{formatINR(suggestion.interest)}</span>
                </div>
                {suggestion.gst > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">GST on interest</span>
                    <span className="tabular-nums">{formatINR(suggestion.gst)}</span>
                  </div>
                )}
                <p className="text-[10px] text-muted-foreground pt-1">
                  Interest = outstanding ×{" "}
                  {((loan.interestRate ?? 0) / cyclesPerYear(freq)).toFixed(3)}%
                  {suggestion.gst > 0 ? ` + GST ${loan.gstOnInterest}%` : ""}.
                  Remaining is principal.
                </p>
              </div>
            )}

            {overrideSplit && (
              <div className="grid grid-cols-3 gap-2">
                <label className="block">
                  <span className="text-xs font-medium">Principal</span>
                  <AmountInput
                    value={principalPortion}
                    onChange={setPrincipalPortion}
                    placeholder={String(suggestedPrincipal)}
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium">Interest</span>
                  <AmountInput
                    value={interestPortion}
                    onChange={setInterestPortion}
                    placeholder={String(suggestion.interest)}
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium">GST</span>
                  <AmountInput
                    value={gstPortion}
                    onChange={setGstPortion}
                    placeholder={String(suggestion.gst)}
                  />
                </label>
              </div>
            )}
            <label className="block">
              <span className="text-xs font-medium">Pay from</span>
              <div className="mt-1">
                <NativeSelect
                  value={accountId}
                  onChange={setAccountId}
                  options={accounts.map((a) => buildAccountOption(a, amt))}
                />
              </div>
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
