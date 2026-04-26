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
import { loanTotals, monthsPerCycle, type LoanFrequency } from "@/lib/loan-math";
import { formatINR, buildAccountOption } from "@/lib/utils";

type ChargeRow = { label: string; amount: string };
const DEFAULT_CHARGE_ROWS: ChargeRow[] = [
  { label: "Processing fee", amount: "" },
  // { label: "GST on processing fee", amount: "" },
  { label: "Stamp duty", amount: "" },
];

type GoldItemRow = {
  name: string;
  quantity: string;
  weightGrams: string;
  purity: string;
  notes: string;
};
const NEW_GOLD_ROW = (): GoldItemRow => ({
  name: "",
  quantity: "1",
  weightGrams: "",
  purity: "22",
  notes: "",
});

const FREQUENCY_OPTIONS: { value: LoanFrequency; label: string; tenureUnit: string }[] = [
  { value: "MONTHLY", label: "Monthly", tenureUnit: "months" },
  { value: "QUARTERLY", label: "Quarterly", tenureUnit: "quarters" },
  { value: "HALF_YEARLY", label: "Half-yearly", tenureUnit: "half-years" },
  { value: "YEARLY", label: "Yearly", tenureUnit: "years" },
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
  const [outstanding, setOutstanding] = useState("");
  const [interestRate, setInterestRate] = useState("");
  const [gstOnInterest, setGstOnInterest] = useState(source === "CARD_EMI" ? "18" : "");
  const [emiAmount, setEmiAmount] = useState("");
  const [tenure, setTenure] = useState("");
  const [frequency, setFrequency] = useState<LoanFrequency>("MONTHLY");
  const [goldItems, setGoldItems] = useState<GoldItemRow[]>([NEW_GOLD_ROW()]);
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
    const totals = loanTotals(p, r, t, frequency, gst);
    if (!totals.emi) return null;
    return totals;
  }, [principal, interestRate, tenure, gstOnInterest, frequency, source]);

  const tenureUnit =
    FREQUENCY_OPTIONS.find((f) => f.value === frequency)?.tenureUnit ?? "months";
  const totalLoanMonths = tenure ? Number(tenure) * monthsPerCycle(frequency) : 0;

  const goldItemsPayload = useMemo(
    () =>
      goldItems
        .map((g) => ({
          name: g.name.trim(),
          quantity: Number(g.quantity) || 1,
          weightGrams: Number(g.weightGrams) || 0,
          purity: g.purity ? Number(g.purity) : null,
          notes: g.notes.trim() || null,
        }))
        .filter((g) => g.name && g.weightGrams > 0),
    [goldItems]
  );
  const totalGoldGrams = goldItemsPayload.reduce(
    (s, g) => s + g.weightGrams * g.quantity,
    0
  );

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
          // Only send outstanding when the user is entering an existing
          // loan and explicitly typed a value — otherwise the API defaults
          // outstanding to principal.
          outstanding:
            isExisting && outstanding !== "" ? Number(outstanding) : undefined,
          interestRate: interestRate ? Number(interestRate) : null,
          gstOnInterest: gstOnInterest ? Number(gstOnInterest) : null,
          emiAmount: effectiveEmi ?? null,
          tenure: tenure ? Number(tenure) : null,
          frequency,
          accountId: source === "BANK" ? accountId || null : null,
          cardId: source === "CARD_EMI" ? cardId : null,
          isExisting,
          startedAt,
          chargeBreakdown: breakdown.length ? breakdown : null,
          charges: breakdown.length ? chargesTotal : null,
          notes: notes.trim() || undefined,
          goldItems: kind === "GOLD" && goldItemsPayload.length ? goldItemsPayload : undefined,
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-medium">Principal (₹)</span>
          <AmountInput value={principal} onChange={setPrincipal} />
        </label>
        <label className="block">
          <span className="text-xs font-medium">Started on</span>
          <DateInput value={startedAt} onChange={(e) => setStartedAt(e.target.value)} />
        </label>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <label className="block">
          <span className="text-xs font-medium">Interest rate (% p.a.)</span>
          <AmountInput value={interestRate} onChange={setInterestRate} placeholder="e.g. 14" />
        </label>
        <label className="block">
          <span className="text-xs font-medium">EMI cadence</span>
          <NativeSelect
            value={frequency}
            onChange={(next) => setFrequency(next as LoanFrequency)}
            options={FREQUENCY_OPTIONS.map((f) => ({ value: f.value, label: f.label }))}
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium">Tenure ({tenureUnit})</span>
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
            placeholder={preview?.emi ? String(Math.round(preview.emi)) : "Auto"}
          />
        </label>
      </div>
      <p className="-mt-1 text-xs text-muted-foreground">
        Leave EMI blank to use the standard reducing-balance calculation.
        {tenure && frequency !== "MONTHLY" && totalLoanMonths > 0 && (
          <> · {tenure} {tenureUnit} = {totalLoanMonths} months total</>
        )}
      </p>

      {source === "CARD_EMI" && (
        <div className="space-y-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium">GST on interest (%)</span>
              <div className="relative">
                <Input
                  type="text"
                  inputMode="decimal"
                  value={gstOnInterest}
                  onChange={(e) =>
                    setGstOnInterest(e.target.value.replace(/[^\d.]/g, ""))
                  }
                  placeholder="18"
                  className="pr-7 tabular-nums"
                />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground select-none"
                >
                  %
                </span>
              </div>
            </label>
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
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            The principal will be subtracted from this card&apos;s available limit
            until the EMI is paid off.
          </p>
        </div>
      )}

      {preview && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">
              {FREQUENCY_OPTIONS.find((f) => f.value === frequency)?.label} EMI
            </span>
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
            {Number(tenure)} {tenureUnit}
            {preview.totalGst > 0 ? ` · ${gstOnInterest}% GST on interest` : ""}).
          </p>
        </div>
      )}

      {source !== "CARD_EMI" && kind === "GOLD" && (
        <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Pledged gold items</span>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-[11px] underline text-muted-foreground hover:text-foreground"
              onClick={() => setGoldItems((rows) => [...rows, NEW_GOLD_ROW()])}
            >
              <Plus className="h-3 w-3" /> Add item
            </button>
          </div>
          <div className="space-y-1.5">
            {goldItems.map((row, i) => (
              <div key={i} className="grid grid-cols-12 gap-1.5">
                <Input
                  className="col-span-4"
                  value={row.name}
                  onChange={(e) =>
                    setGoldItems((rows) =>
                      rows.map((r, j) => (j === i ? { ...r, name: e.target.value } : r))
                    )
                  }
                  placeholder="e.g. Bangle, Coin, Chain"
                  maxLength={80}
                />
                <Input
                  className="col-span-2"
                  type="number"
                  min={1}
                  value={row.quantity}
                  onChange={(e) =>
                    setGoldItems((rows) =>
                      rows.map((r, j) => (j === i ? { ...r, quantity: e.target.value } : r))
                    )
                  }
                  placeholder="Qty"
                  aria-label="Quantity"
                />
                <div className="col-span-3">
                  <AmountInput
                    value={row.weightGrams}
                    onChange={(next) =>
                      setGoldItems((rows) =>
                        rows.map((r, j) => (j === i ? { ...r, weightGrams: next } : r))
                      )
                    }
                    placeholder="g / piece"
                  />
                </div>
                <Input
                  className="col-span-2"
                  type="number"
                  min={1}
                  max={24}
                  value={row.purity}
                  onChange={(e) =>
                    setGoldItems((rows) =>
                      rows.map((r, j) => (j === i ? { ...r, purity: e.target.value } : r))
                    )
                  }
                  placeholder="Karat"
                  aria-label="Purity (karat)"
                />
                {goldItems.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="col-span-1"
                    onClick={() =>
                      setGoldItems((rows) => rows.filter((_, j) => j !== i))
                    }
                    aria-label="Remove item"
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                ) : (
                  <div className="col-span-1" />
                )}
              </div>
            ))}
          </div>
          {totalGoldGrams > 0 && (
            <p className="text-[10px] text-muted-foreground">
              Total pledged: {totalGoldGrams.toFixed(3)} g across{" "}
              {goldItemsPayload.reduce((s, g) => s + g.quantity, 0)} item(s)
            </p>
          )}
          <p className="text-[10px] text-muted-foreground">
            Karat: 24 = pure, 22 = jewellery, 18 = ornament. Weight is per single piece.
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

      {source !== "CARD_EMI" && (
        <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={isExisting}
              onChange={(e) => setIsExisting(e.target.checked)}
            />
            <span className="text-sm">
              {source === "BANK"
                ? "Already disbursed (don't create a disbursement transaction)"
                : "Existing loan (already taken — partially or fully repaid)"}
            </span>
          </label>
          {isExisting && (
            <label className="block">
              <span className="text-xs font-medium">Current outstanding (₹)</span>
              <AmountInput
                value={outstanding}
                onChange={setOutstanding}
                placeholder={principalNum > 0 ? String(principalNum) : "Same as principal"}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Leave blank if no payments yet.{" "}
                {outstanding !== "" && Number(outstanding) === 0
                  ? "Loan will be marked as paid and closed automatically."
                  : "Enter the remaining balance after EMIs already paid."}
              </p>
            </label>
          )}
        </div>
      )}

      <label className="block">
        <span className="text-xs font-medium">Notes</span>
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
      </label>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
});
