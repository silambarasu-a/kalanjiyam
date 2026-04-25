"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import useSWR, { mutate as globalMutate } from "swr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { mutateBalances } from "@/lib/mutate-balances";

type Account = { id: string; name: string; kind: string };
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

export function LoanForm({
  source,
  onSaved,
  onCancel,
  lockedCardId,
}: {
  source: "BANK" | "HAND_FORMAL" | "CARD_EMI";
  onSaved: () => void;
  onCancel: () => void;
  lockedCardId?: string;
}) {
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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync from prop
    if (lockedCardId) setCardId(lockedCardId);
  }, [lockedCardId]);

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
          emiAmount: emiAmount ? Number(emiAmount) : null,
          tenure: tenure ? Number(tenure) : null,
          accountId: source === "BANK" ? accountId || null : null,
          cardId: source === "CARD_EMI" ? cardId : null,
          isExisting,
          startedAt,
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

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="text-xs font-medium">
          {source === "CARD_EMI" ? "Merchant / description" : "Lender"}
        </span>
        <Input
          value={lender}
          onChange={(e) => setLender(e.target.value)}
          placeholder={source === "CARD_EMI" ? "What was purchased" : "Bank / lender name"}
          autoFocus
          maxLength={120}
        />
      </label>

      {source !== "CARD_EMI" && (
        <label className="block">
          <span className="text-xs font-medium">Kind</span>
          <select
            className="w-full rounded border border-input bg-background px-2 py-2 text-sm mt-1"
            value={kind}
            onChange={(e) => setKind(e.target.value as LoanKind)}
          >
            {KIND_OPTIONS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-medium">Principal (₹)</span>
          <Input
            type="number"
            inputMode="decimal"
            value={principal}
            onChange={(e) => setPrincipal(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium">Started on</span>
          <Input type="date" value={startedAt} onChange={(e) => setStartedAt(e.target.value)} />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-medium">Interest rate (% p.a.)</span>
          <Input
            type="number"
            inputMode="decimal"
            value={interestRate}
            onChange={(e) => setInterestRate(e.target.value)}
            placeholder="e.g. 14"
          />
        </label>
        {source === "CARD_EMI" && (
          <label className="block">
            <span className="text-xs font-medium">GST on interest (%)</span>
            <Input
              type="number"
              inputMode="decimal"
              value={gstOnInterest}
              onChange={(e) => setGstOnInterest(e.target.value)}
              placeholder="18"
            />
          </label>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-medium">EMI amount (₹)</span>
          <Input
            type="number"
            inputMode="decimal"
            value={emiAmount}
            onChange={(e) => setEmiAmount(e.target.value)}
          />
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
      </div>

      {source === "BANK" && (
        <>
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
              <select
                className="w-full rounded border border-input bg-background px-2 py-2 text-sm mt-1"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
              >
                <option value="">— pick —</option>
                {bankAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </>
      )}

      {source === "CARD_EMI" && (
        <label className="block">
          <span className="text-xs font-medium">Credit card</span>
          <select
            className="w-full rounded border border-input bg-background px-2 py-2 text-sm mt-1"
            value={cardId}
            onChange={(e) => setCardId(e.target.value)}
            disabled={!!lockedCardId}
          >
            <option value="">— pick —</option>
            {creditCards.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
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

      <div className="flex gap-2 justify-end pt-1">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={submitting}>
          {submitting ? "Saving…" : "Create"}
        </Button>
      </div>
    </div>
  );
}
