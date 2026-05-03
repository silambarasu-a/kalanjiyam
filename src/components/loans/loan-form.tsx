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
import { formatINR, formatDate, groupAccountOptions } from "@/lib/utils";
import { nextStatementDueDate } from "@/lib/statement-period";
import type { LoanKind } from "@/generated/prisma/client";

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
type Card = {
  id: string;
  name: string;
  kind: "CREDIT" | "DEBIT";
  statementDate?: number | null;
  gracePeriod?: number | null;
  currentBalance?: number | null;
};
type Contact = {
  id: string;
  name: string;
  relationship: string | null;
  active: boolean;
};

const KIND_OPTIONS: LoanKind[] = [
  "PERSONAL",
  "HOME",
  "CAR",
  "GOLD",
  "BUSINESS",
  "EDUCATION",
  "CREDIT_CARD_LOAN",
  "OTHER",
];

const KIND_LABEL: Record<LoanKind, string> = {
  PERSONAL: "Personal",
  HOME: "Home",
  CAR: "Car",
  GOLD: "Gold",
  BUSINESS: "Business",
  EDUCATION: "Education",
  CREDIT_CARD_LOAN: "Credit card loan",
  OTHER: "Other",
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export type LoanFormHandle = {
  /** Trigger a submit from outside the component (e.g. a sibling DialogFooter button). */
  submit: () => void;
};

export type EditingLoan = {
  id: string;
  kind: LoanKind;
  source: "BANK" | "HAND_FORMAL" | "CARD_EMI";
  lender: string;
  lenderContact: { id: string; name: string } | null;
  principal: number;
  outstanding: number;
  interestRate: number | null;
  gstOnInterest: number | null;
  emiAmount: number | null;
  tenure: number | null;
  frequency: LoanFrequency | null;
  charges: number | null;
  chargeBreakdown: { label: string; amount: number }[] | null;
  accountId: string | null;
  cardId: string | null;
  loanAccountNumber: string | null;
  loanStatementDate: number | null;
  loanGracePeriod: number | null;
  isExisting: boolean;
  startedAt: string;
  notes: string | null;
  goldItems: {
    name: string;
    quantity: number;
    weightGrams: number;
    purity: number | null;
    notes: string | null;
  }[];
};

type LoanFormProps = {
  source: "BANK" | "HAND_FORMAL" | "CARD_EMI";
  onSaved: () => void;
  /** Mirrors internal `submitting` state up so a parent button can disable. */
  onSubmittingChange?: (submitting: boolean) => void;
  lockedCardId?: string;
  /** When provided, the form prefills from this loan and submits via PATCH. */
  editingLoan?: EditingLoan;
};

export const LoanForm = forwardRef<LoanFormHandle, LoanFormProps>(function LoanForm(
  { source, onSaved, onSubmittingChange, lockedCardId, editingLoan },
  ref
) {
  const editing = !!editingLoan;
  const { data: accountsData } = useSWR<{ accounts: Account[] }>("/api/accounts", fetcher);
  const { data: cardsData } = useSWR<{ cards: Card[] }>("/api/cards", fetcher);
  const { data: contactsData, isLoading: contactsLoading } = useSWR<{
    members: Contact[];
  }>(source === "HAND_FORMAL" ? "/api/contacts" : null, fetcher);
  const bankAccounts = (accountsData?.accounts ?? []).filter((a) => a.kind === "BANK");
  const creditCards = (cardsData?.cards ?? []).filter((c) => c.kind === "CREDIT");
  // Show all active contacts, plus the currently-linked one even if it's
  // archived so the edit form doesn't drop the selection silently.
  const linkedContactId = editingLoan?.lenderContact?.id;
  const contacts = (contactsData?.members ?? []).filter(
    (m) => m.active || m.id === linkedContactId,
  );

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const numStr = (n: number | null | undefined) =>
    n == null || !Number.isFinite(n) ? "" : String(n);
  const [kind, setKind] = useState<LoanKind>(
    (editingLoan?.kind as LoanKind) ?? "PERSONAL"
  );
  const [lender, setLender] = useState(editingLoan?.lender ?? "");
  const [lenderContactId, setLenderContactId] = useState(
    editingLoan?.lenderContact?.id ?? "",
  );
  const [principal, setPrincipal] = useState(numStr(editingLoan?.principal));
  const [outstanding, setOutstanding] = useState(
    editingLoan ? numStr(editingLoan.outstanding) : ""
  );
  const [interestRate, setInterestRate] = useState(
    numStr(editingLoan?.interestRate)
  );
  const [gstOnInterest, setGstOnInterest] = useState(
    editingLoan
      ? numStr(editingLoan.gstOnInterest)
      : source === "CARD_EMI"
        ? "18"
        : ""
  );
  const [emiAmount, setEmiAmount] = useState(numStr(editingLoan?.emiAmount));
  const [tenure, setTenure] = useState(numStr(editingLoan?.tenure));
  const [frequency, setFrequency] = useState<LoanFrequency>(
    (editingLoan?.frequency as LoanFrequency | null) ?? "MONTHLY"
  );
  const [goldItems, setGoldItems] = useState<GoldItemRow[]>(
    editingLoan && editingLoan.goldItems.length > 0
      ? editingLoan.goldItems.map((g) => ({
          name: g.name,
          quantity: String(g.quantity ?? 1),
          weightGrams: String(g.weightGrams),
          purity: g.purity != null ? String(g.purity) : "",
          notes: g.notes ?? "",
        }))
      : [NEW_GOLD_ROW()]
  );
  const [accountId, setAccountId] = useState(editingLoan?.accountId ?? "");
  const [cardId, setCardId] = useState(
    editingLoan?.cardId ?? lockedCardId ?? ""
  );
  const [loanAccountNumber, setLoanAccountNumber] = useState(
    editingLoan?.loanAccountNumber ?? ""
  );
  const [loanStatementDate, setLoanStatementDate] = useState(
    editingLoan?.loanStatementDate != null ? String(editingLoan.loanStatementDate) : ""
  );
  const [loanGracePeriod, setLoanGracePeriod] = useState(
    editingLoan?.loanGracePeriod != null ? String(editingLoan.loanGracePeriod) : ""
  );
  const [hasSeparateLoanCard, setHasSeparateLoanCard] = useState(
    !!editingLoan?.loanAccountNumber ||
      editingLoan?.loanStatementDate != null ||
      editingLoan?.loanGracePeriod != null
  );
  const [isExisting, setIsExisting] = useState(
    editingLoan
      ? editingLoan.isExisting
      : source === "CARD_EMI"
        ? true
        : false
  );
  const [startedAt, setStartedAt] = useState(
    editingLoan ? editingLoan.startedAt.slice(0, 10) : today
  );
  const [notes, setNotes] = useState(editingLoan?.notes ?? "");
  const [chargeRows, setChargeRows] = useState<ChargeRow[]>(
    editingLoan
      ? editingLoan.chargeBreakdown && editingLoan.chargeBreakdown.length > 0
        ? editingLoan.chargeBreakdown.map((c) => ({
            label: c.label,
            amount: String(c.amount),
          }))
        : [{ label: "", amount: "" }]
      : DEFAULT_CHARGE_ROWS
  );
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
    const gst =
      (source === "CARD_EMI" || kind === "CREDIT_CARD_LOAN") && gstOnInterest
        ? Number(gstOnInterest)
        : null;
    if (!p || !t || !Number.isFinite(r) || r < 0) return null;
    const totals = loanTotals(p, r, t, frequency, gst);
    if (!totals.emi) return null;
    return totals;
  }, [principal, interestRate, tenure, gstOnInterest, frequency, source, kind]);

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
    if (source === "HAND_FORMAL") {
      // Only enforce on create. Editing legacy hand loans (created before
      // contacts existed) must still be saveable even when no contact is
      // linked — the user can pick one later.
      if (!editing && !lenderContactId) {
        setError("Pick the contact you borrowed from");
        return;
      }
    } else if (!lender.trim()) {
      setError("Enter lender");
      return;
    }
    if (source === "CARD_EMI" && !cardId) {
      setError("Pick a credit card");
      return;
    }
    if (kind === "CREDIT_CARD_LOAN" && !cardId && !loanStatementDate) {
      setError("Pick a credit card or enter a statement day for the loan");
      return;
    }
    setSubmitting(true);
    try {
      // Edit mode always sends outstanding (so the user can correct it
      // independently of principal). Create mode only sends it when the
      // user ticked "isExisting" and typed a value.
      const outstandingPayload = editing
        ? outstanding !== ""
          ? Number(outstanding)
          : principalNum
        : isExisting && outstanding !== ""
          ? Number(outstanding)
          : undefined;

      // For HAND_FORMAL the server resolves the canonical lender name from
      // the picked contact, but the validator still requires a non-empty
      // string — fall back to the contact's name we have on hand.
      const submittedLender =
        source === "HAND_FORMAL"
          ? (contacts.find((c) => c.id === lenderContactId)?.name ??
              lender.trim() ??
              "")
          : lender.trim();
      const payload = {
        kind,
        ...(editing ? {} : { source }),
        lender: submittedLender,
        lenderContactId:
          source === "HAND_FORMAL" ? lenderContactId || null : undefined,
        principal: principalNum,
        outstanding: outstandingPayload,
        interestRate: interestRate ? Number(interestRate) : null,
        gstOnInterest: gstOnInterest ? Number(gstOnInterest) : null,
        emiAmount: effectiveEmi ?? null,
        tenure: tenure ? Number(tenure) : null,
        frequency,
        accountId:
          source === "BANK" || source === "HAND_FORMAL"
            ? accountId || null
            : null,
        cardId:
          source === "CARD_EMI" || kind === "CREDIT_CARD_LOAN"
            ? cardId || null
            : null,
        loanAccountNumber:
          kind === "CREDIT_CARD_LOAN" && (hasSeparateLoanCard || !cardId)
            ? loanAccountNumber.trim() || null
            : null,
        loanStatementDate:
          kind === "CREDIT_CARD_LOAN" &&
          (hasSeparateLoanCard || !cardId) &&
          loanStatementDate
            ? Number(loanStatementDate)
            : null,
        loanGracePeriod:
          kind === "CREDIT_CARD_LOAN" &&
          (hasSeparateLoanCard || !cardId) &&
          loanGracePeriod
            ? Number(loanGracePeriod)
            : null,
        isExisting,
        startedAt,
        chargeBreakdown: breakdown.length ? breakdown : null,
        charges: breakdown.length ? chargesTotal : null,
        notes: notes.trim() || undefined,
        goldItems:
          kind === "GOLD"
            ? goldItemsPayload
            : editing
              ? []
              : undefined,
      };

      const res = await fetch(
        editing ? `/api/loans/${editingLoan!.id}` : "/api/loans",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Failed");
        return;
      }
      toast.success(
        editing
          ? "Loan updated"
          : source === "CARD_EMI"
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
            {source === "HAND_FORMAL" ? (
              <div className="space-y-1">
                <div className="mt-1">
                  <NativeSelect
                    value={lenderContactId}
                    onChange={setLenderContactId}
                    placeholder={
                      contactsLoading
                        ? "Loading contacts…"
                        : contacts.length > 0
                          ? "— pick a contact —"
                          : "No contacts yet"
                    }
                    options={contacts.map((c) => ({
                      value: c.id,
                      label: c.active ? c.name : `${c.name} (archived)`,
                      hint: c.relationship ?? undefined,
                    }))}
                    disabled={contactsLoading || contacts.length === 0}
                    autoFocus
                  />
                </div>
                {!contactsLoading && contacts.length === 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    Add the person under{" "}
                    <a href="/contacts" className="underline">
                      Contacts
                    </a>{" "}
                    first, then come back here.
                  </p>
                )}
                {editing &&
                  !lenderContactId &&
                  editingLoan?.lender && (
                    <p className="text-[11px] text-muted-foreground">
                      Currently:{" "}
                      <span className="font-medium text-foreground">
                        {editingLoan.lender}
                      </span>{" "}
                      — pick a contact to link this loan to your contacts ledger.
                    </p>
                  )}
              </div>
            ) : (
              <BankPicker value={lender} onChange={setLender} autoFocus />
            )}
          </label>
          <label className="block">
            <span className="text-xs font-medium">Kind</span>
            <div className="">
              <NativeSelect
                value={kind}
                onChange={(next) => setKind(next as LoanKind)}
                options={KIND_OPTIONS.map((k) => ({ value: k, label: KIND_LABEL[k] }))}
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
          <div className="relative">
            <Input
              type="text"
              inputMode="decimal"
              value={interestRate}
              onChange={(e) =>
                setInterestRate(e.target.value.replace(/[^\d.]/g, ""))
              }
              placeholder="e.g. 14"
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

      {(source === "CARD_EMI" || kind === "CREDIT_CARD_LOAN") && (
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
              <span className="text-xs font-medium">
                Credit card
                {kind === "CREDIT_CARD_LOAN" && (
                  <span className="text-muted-foreground"> (optional)</span>
                )}
              </span>
              <div className="mt-1">
                <NativeSelect
                  value={cardId}
                  onChange={setCardId}
                  options={[
                    ...(kind === "CREDIT_CARD_LOAN"
                      ? [{ value: "", label: "— None (standalone loan account) —" }]
                      : []),
                    ...creditCards.map((c) => ({ value: c.id, label: c.name })),
                  ]}
                  disabled={!!lockedCardId}
                />
              </div>
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            {source === "CARD_EMI"
              ? "The principal will be subtracted from this card's available limit until the EMI is paid off."
              : kind === "CREDIT_CARD_LOAN" && !cardId
                ? "Standalone loan: the linked card is optional. Enable the override below and set the statement day + grace period the loan bills on."
                : "Each EMI is billed on this card's monthly statement. Due dates follow the card's statement date + grace period."}
          </p>
          {kind === "CREDIT_CARD_LOAN" && cardId && (() => {
            const c = creditCards.find((c) => c.id === cardId);
            if (!c) return null;
            const sd = loanStatementDate
              ? Number(loanStatementDate)
              : c.statementDate ?? null;
            const grace = loanGracePeriod
              ? Number(loanGracePeriod)
              : c.gracePeriod ?? 0;
            const balance = c.currentBalance ?? 0;
            const upcomingDue =
              sd != null
                ? nextStatementDueDate(new Date(), sd, grace)
                : null;
            if (balance <= 0 && !upcomingDue) return null;
            return (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs space-y-1.5 dark:border-amber-400/30">
                <div className="font-medium text-amber-800 dark:text-amber-300">
                  Heads up — this card already has activity
                </div>
                {balance > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      Current outstanding on {c.name}
                    </span>
                    <span className="font-semibold tabular-nums text-amber-700 dark:text-amber-400">
                      {formatINR(balance)}
                    </span>
                  </div>
                )}
                {upcomingDue && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      Next statement due
                    </span>
                    <span className="tabular-nums">
                      {formatDate(upcomingDue)}
                    </span>
                  </div>
                )}
                <p className="pt-0.5 text-[10px] text-muted-foreground">
                  Loan EMIs land on the same statement{" "}
                  {balance > 0
                    ? "alongside the existing balance — both must be cleared by the due date."
                    : "as the card's regular spend."}
                </p>
              </div>
            );
          })()}
          {kind === "CREDIT_CARD_LOAN" && (hasSeparateLoanCard || !cardId) && (
            <div className="mt-2 space-y-2 rounded-lg border border-border bg-muted/30 p-3">
              {cardId ? (
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={hasSeparateLoanCard}
                    onChange={(e) => setHasSeparateLoanCard(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    Loan has its own account / billing-cycle override
                    <span className="block text-[11px] text-muted-foreground">
                      Some banks (e.g. HDFC Insta Jumbo Loan) issue a separate
                      Account Number (AAN) for the loan with its own statement
                      cycle. Use this when the loan bills differently from the
                      parent card.
                    </span>
                  </span>
                </label>
              ) : (
                <p className="text-xs text-muted-foreground">
                  <strong className="font-medium text-foreground">
                    Standalone loan account.
                  </strong>{" "}
                  Enter the loan&apos;s billing cycle directly (statement day
                  is required so the next due date can be calculated).
                </p>
              )}
              <div className={cardId ? "space-y-2 pl-6" : "space-y-2"}>
                <label className="block">
                  <span className="text-xs font-medium">
                    Loan account number
                    <span className="text-muted-foreground"> (optional)</span>
                  </span>
                  <Input
                    value={loanAccountNumber}
                    onChange={(e) => setLoanAccountNumber(e.target.value)}
                    placeholder="e.g. 5524 67XX XXXX 1234"
                    maxLength={40}
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-xs font-medium">
                      Statement day (1–31)
                      {!cardId && (
                        <span className="text-destructive"> *</span>
                      )}
                    </span>
                    <Input
                      type="number"
                      min={1}
                      max={31}
                      value={loanStatementDate}
                      onChange={(e) => setLoanStatementDate(e.target.value)}
                      placeholder={
                        (() => {
                          const c = creditCards.find((c) => c.id === cardId);
                          return c?.statementDate != null
                            ? `card: ${c.statementDate}`
                            : "13";
                        })()
                      }
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium">
                      Grace period (days)
                    </span>
                    <Input
                      type="number"
                      min={0}
                      max={60}
                      value={loanGracePeriod}
                      onChange={(e) => setLoanGracePeriod(e.target.value)}
                      placeholder={
                        (() => {
                          const c = creditCards.find((c) => c.id === cardId);
                          return c?.gracePeriod != null
                            ? `card: ${c.gracePeriod}`
                            : "20";
                        })()
                      }
                    />
                  </label>
                </div>
                {cardId && (
                  <p className="text-[11px] text-muted-foreground">
                    Leave blank to use the linked card&apos;s billing cycle.
                  </p>
                )}
              </div>
            </div>
          )}
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
        </>
      )}

      {(source === "BANK" || source === "HAND_FORMAL") &&
        (!isExisting || editing) && (
          <label className="block">
            <span className="text-xs font-medium">
              {editing
                ? "Linked bank account"
                : source === "HAND_FORMAL"
                  ? "Received into (bank account)"
                  : "Disbursed into (bank account)"}
            </span>
            <div className="mt-1">
              <NativeSelect
                value={accountId}
                onChange={setAccountId}
                options={groupAccountOptions(bankAccounts, 0)}
              />
            </div>
            {!editing && source === "HAND_FORMAL" && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Saves an INCOME transaction for the borrowed amount on this
                account. Leave blank to track only the liability.
              </p>
            )}
            {editing && !isExisting && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                {source === "BANK"
                  ? "Disbursement and any upfront charges already posted to the current account will move with this change."
                  : "The income transaction already posted to the current account will move with this change."}
              </p>
            )}
          </label>
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
                : "Already received (don't create an income transaction)"}
            </span>
          </label>
          {!editing && isExisting && (
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
          {editing &&
            source === "BANK" &&
            isExisting !== editingLoan!.isExisting && (
              <p className="text-[11px] text-muted-foreground">
                {isExisting
                  ? "Saving will remove the auto-created disbursement (and any upfront charges) on the linked account."
                  : "Saving will create a disbursement transaction (and an upfront-charges expense, if any) on the linked account."}
              </p>
            )}
        </div>
      )}

      {editing && (
        <label className="block">
          <span className="text-xs font-medium">Current outstanding (₹)</span>
          <AmountInput
            value={outstanding}
            onChange={setOutstanding}
            placeholder={principalNum > 0 ? String(principalNum) : ""}
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            Editing this overrides the running balance — repayments already
            recorded won&apos;t be touched.
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
