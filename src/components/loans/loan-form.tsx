"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { toast } from "sonner";
import useSWR, { mutate as globalMutate } from "swr";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { AmountInput } from "@/components/ui/amount-input";
import { BankPicker } from "@/components/ui/bank-picker";
import { NativeSelect } from "@/components/ui/native-select";
import { mutateBalances } from "@/lib/mutate-balances";
import { loanTotals } from "@/lib/loan-math";
import { formatINR, buildAccountOption } from "@/lib/utils";

type ChargeRow = { label: string; amount: string };
const DEFAULT_CHARGE_ROWS: ChargeRow[] = [
  { label: "Processing fee", amount: "" },
  // { label: "GST on processing fee", amount: "" },
  { label: "Stamp duty", amount: "" },
];

type Account = {
  id: string;
  name: string;
  kind: string;
  balance: number;
  availableLimit: number | null;
};
type Card = { id: string; name: string; kind: "CREDIT" | "DEBIT" };
type LoanKind =
  | "PERSONAL"
  | "HOME"
  | "CAR"
  | "GOLD"
  | "BUSINESS"
  | "EDUCATION"
  | "OTHER";

const KIND_OPTIONS: LoanKind[] = [
  "PERSONAL",
  "HOME",
  "CAR",
  "GOLD",
  "BUSINESS",
  "EDUCATION",
  "OTHER",
];

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export type LoanFormHandle = {
  /** Trigger a submit from outside the component (e.g. a sibling DialogFooter button). */
  submit: () => void;
};

type LoanFormProps = {
  source: "BANK" | "HAND_FORMAL" | "CARD_EMI";
  onSaved: () => void;
  /** Mirrors internal `submitting` state up so a parent button can disable. */
  onSubmittingChange?: (submitting: boolean) => void;
  lockedCardId?: string;
};

export const LoanForm = forwardRef<LoanFormHandle, LoanFormProps>(function LoanForm(
  { source, onSaved, onSubmittingChange, lockedCardId },
  ref
) {
  const { data: accountsData } = useSWR<{ accounts: Account[] }>("/api/accounts", fetcher);
  const { data: cardsData } = useSWR<{ cards: Card[] }>("/api/cards", fetcher);
  const bankAccounts = (accountsData?.accounts ?? []).filter((a) => a.kind === "BANK");
  const creditCards = (cardsData?.cards ?? []).filter((c) => c.kind === "CREDIT");

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [kind, setKind] = useState<LoanKind>("PERSONAL");
  const [lender, setLender] = useState("");
  const [principal, setPrincipal] = useState("");
  const [interestRate, setInterestRate] = useState("");
  const [gstOnInterest, setGstOnInterest] = useState(source === "CARD_EMI" ? "18" : "");
  const [emiAmount, setEmiAmount] = useState("");
  const [tenure, setTenure] = useState("");
  const [accountId, setAccountId] = useState("");
  const [cardId, setCardId] = useState(lockedCardId ?? "");
  const [isExisting, setIsExisting] = useState(source === "CARD_EMI" ? true : false);
  const [startedAt, setStartedAt] = useState(today);
  const [notes, setNotes] = useState("");
  const [chargeRows, setChargeRows] = useState<ChargeRow[]>(DEFAULT_CHARGE_ROWS);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mirror the busy flag up so a sibling DialogFooter button can disable
  // itself while the form is in flight.
  useEffect(() => {
    onSubmittingChange?.(submitting);
  }, [submitting, onSubmittingChange]);

  useEffect(() => {
    if (lockedCardId) setCardId(lockedCardId);
  }, [lockedCardId]);

  // Live EMI preview based on principal + rate + tenure, using the standard
  // reducing-balance formula. The user can still override emiAmount
  // explicitly (some bank quotes round differently).
  const preview = useMemo(() => {
    const p = Number(principal);
    const r = Number(interestRate);
    const t = Number(tenure);
    const gst = source === "CARD_EMI" && gstOnInterest ? Number(gstOnInterest) : null;
    if (!p || !t || !Number.isFinite(r) || r < 0) return null;
    const totals = loanTotals(p, r, t, gst);
    if (!totals.emi) return null;
    return totals;
  }, [principal, interestRate, tenure, gstOnInterest, source]);

  const effectiveEmi = emiAmount ? Number(emiAmount) : preview?.emi ?? null;

  // Charges total + disbursed amount preview. Filtered breakdown drops
  // empty/zero rows so the API only sees real entries.
  const breakdown = useMemo(
    () =>
      chargeRows
        .map((c) => ({
          label: c.label.trim(),
          amount: Number(c.amount) || 0,
        }))
        .filter((c) => c.label && c.amount > 0),
    [chargeRows]
  );
  const chargesTotal = useMemo(
    () => breakdown.reduce((s, c) => s + c.amount, 0),
    [breakdown]
  );
  const principalNum = Number(principal) || 0;
  const disbursedAmount = Math.max(0, principalNum - chargesTotal);

  async function submit() {
    setError(null);
    const principalNum = Number(principal);
    if (!principalNum || principalNum <= 0) {
      setError("Enter principal");
      return;
    }
    if (!lender.trim()) {
      setError("Enter lender");
      return;
    }
    if (source === "CARD_EMI" && !cardId) {
      setError("Pick a credit card");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/loans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind,
          source,
          lender: lender.trim(),
          principal: principalNum,
          interestRate: interestRate ? Number(interestRate) : null,
          gstOnInterest: gstOnInterest ? Number(gstOnInterest) : null,
          emiAmount: effectiveEmi ?? null,
          tenure: tenure ? Number(tenure) : null,
          accountId: source === "BANK" ? accountId || null : null,
          cardId: source === "CARD_EMI" ? cardId : null,
          isExisting,
          startedAt,
          chargeBreakdown: breakdown.length ? breakdown : null,
          charges: breakdown.length ? chargesTotal : null,
          notes: notes.trim() || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Failed");
        return;
      }
      toast.success(
        source === "CARD_EMI"
          ? "EMI plan created — card limit updated"
          : "Loan created"
      );
      globalMutate((k) => typeof k === "string" && k.startsWith("/api/loans"));
      await mutateBalances();
      onSaved();
    } finally {
      setSubmitting(false);
    }
  }

  // Expose submit() so the parent dialog's footer can trigger it.
  useImperativeHandle(ref, () => ({ submit }));

  return (
    <div className="space-y-3">
      {source === "CARD_EMI" ? (
        <label className="block">
          <span className="text-xs font-medium">Merchant / description</span>
          <Input
            value={lender}
            onChange={(e) => setLender(e.target.value)}
            placeholder="What was purchased"
            autoFocus
            maxLength={120}
          />
        </label>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-medium">Lender</span>
            <BankPicker value={lender} onChange={setLender} autoFocus />
          </label>
          <label className="block">
            <span className="text-xs font-medium">Kind</span>
            <div className="">
              <NativeSelect
                value={kind}
                onChange={(next) => setKind(next as LoanKind)}
                options={KIND_OPTIONS.map((k) => ({ value: k, label: k }))}
              />
            </div>
          </label>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-medium">Principal (₹)</span>
          <AmountInput value={principal} onChange={setPrincipal} />
        </label>
        <label className="block">
          <span className="text-xs font-medium">Started on</span>
          <DateInput value={startedAt} onChange={(e) => setStartedAt(e.target.value)} />
        </label>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <label className="block">
          <span className="text-xs font-medium">Interest rate (% p.a.)</span>
          <AmountInput value={interestRate} onChange={setInterestRate} placeholder="e.g. 14" />
        </label>
        <label className="block">
          <span className="text-xs font-medium">Tenure (months)</span>
          <Input
            type="number"
            min={1}
            value={tenure}
            onChange={(e) => setTenure(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium">EMI amount (₹)</span>
          <AmountInput
            value={emiAmount}
            onChange={setEmiAmount}
            placeholder={preview?.emi ? String(preview.emi) : "Auto"}
          />
        </label>
      </div>
      <p className="-mt-1 text-xs text-muted-foreground">
        Leave EMI blank to use the standard reducing-balance calculation.
      </p>

      {source === "CARD_EMI" && (
        <label className="block">
          <span className="text-xs font-medium">GST on interest (%)</span>
          <AmountInput
            value={gstOnInterest}
            onChange={setGstOnInterest}
            placeholder="18"
          />
        </label>
      )}

      {preview && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Monthly EMI</span>
            <span className="font-semibold text-base text-foreground tabular-nums">
              {formatINR(preview.emi)}
              {emiAmount && Number(emiAmount) !== preview.emi && (
                <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                  · using your override
                </span>
              )}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Total interest</span>
            <span className="tabular-nums">{formatINR(preview.totalInterest)}</span>
          </div>
          {preview.totalGst > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Total GST on interest</span>
              <span className="tabular-nums">{formatINR(preview.totalGst)}</span>
            </div>
          )}
          <div className="flex items-center justify-between border-t border-primary/20 pt-1.5 mt-1.5">
            <span className="text-muted-foreground">Total payable</span>
            <span className="font-medium tabular-nums">
              {formatINR(preview.totalPayable)}
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground pt-1">
            Standard reducing-balance EMI (
            {Number(interestRate)}% p.a. ·{" "}
            {Number(tenure)} months
            {preview.totalGst > 0 ? ` · ${gstOnInterest}% GST on interest` : ""}).
          </p>
        </div>
      )}

      {source === "BANK" && (
        <>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">Upfront charges</span>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-[11px] underline text-muted-foreground hover:text-foreground"
                onClick={() =>
                  setChargeRows((rows) => [...rows, { label: "", amount: "" }])
                }
              >
                <Plus className="h-3 w-3" /> Add line
              </button>
            </div>
            <div className="space-y-1.5">
              {chargeRows.map((row, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    value={row.label}
                    onChange={(e) =>
                      setChargeRows((rows) =>
                        rows.map((r, j) => (j === i ? { ...r, label: e.target.value } : r))
                      )
                    }
                    placeholder="e.g. Insurance premium"
                    maxLength={60}
                    className="flex-1"
                  />
                  <div className="w-44">
                    <AmountInput
                      value={row.amount}
                      onChange={(next) =>
                        setChargeRows((rows) =>
                          rows.map((r, j) => (j === i ? { ...r, amount: next } : r))
                        )
                      }
                      placeholder="0"
                    />
                  </div>
                  {chargeRows.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        setChargeRows((rows) => rows.filter((_, j) => j !== i))
                      }
                      aria-label="Remove charge"
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
            {principalNum > 0 && (
              <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Loan principal</span>
                  <span className="tabular-nums">{formatINR(principalNum)}</span>
                </div>
                {chargesTotal > 0 && (
                  <div className="flex items-center justify-between text-destructive">
                    <span>− Upfront charges</span>
                    <span className="tabular-nums">{formatINR(chargesTotal)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between border-t border-border pt-1.5 mt-1 font-medium">
                  <span>Disbursed to your account</span>
                  <span className="tabular-nums">{formatINR(disbursedAmount)}</span>
                </div>
                <p className="text-[10px] text-muted-foreground pt-1">
                  Outstanding starts at the full principal — interest accrues on{" "}
                  {formatINR(principalNum)}, not the disbursed amount.
                </p>
              </div>
            )}
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={isExisting}
              onChange={(e) => setIsExisting(e.target.checked)}
            />
            <span className="text-sm">
              Already disbursed (don&apos;t create a disbursement transaction)
            </span>
          </label>
          {!isExisting && (
            <label className="block">
              <span className="text-xs font-medium">Disbursed into (bank account)</span>
              <div className="mt-1">
                <NativeSelect
                  value={accountId}
                  onChange={setAccountId}
                  options={bankAccounts.map((a) => buildAccountOption(a, 0))}
                />
              </div>
            </label>
          )}
        </>
      )}

      {source === "CARD_EMI" && (
        <label className="block">
          <span className="text-xs font-medium">Credit card</span>
          <div className="mt-1">
            <NativeSelect
              value={cardId}
              onChange={setCardId}
              options={creditCards.map((c) => ({ value: c.id, label: c.name }))}
              disabled={!!lockedCardId}
            />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            The principal will be subtracted from this card&apos;s available limit until the EMI
            is paid off.
          </p>
        </label>
      )}

      <label className="block">
        <span className="text-xs font-medium">Notes</span>
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
      </label>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
});
