"use client";

import { useEffect, useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AmountInput } from "@/components/ui/amount-input";
import { mutateBalances } from "@/lib/mutate-balances";

export type CardSnapshot = {
  id: string;
  name: string;
  kind: "DEBIT" | "CREDIT";
  network: "VISA" | "MASTERCARD" | "RUPAY" | "AMEX" | "DINERS" | "OTHER";
  supportsUpi: boolean;
  last4: string | null;
  limitMode: "SOLO" | "SHARED";
  parentAccount: { id: string; name: string } | null;
  creditLimit: number | null;
};

type BankAccountRow = { id: string; name: string; kind: string };

const fetcher = (url: string) => fetch(url).then((r) => r.json());
const NETWORKS = ["VISA", "MASTERCARD", "RUPAY", "AMEX", "DINERS", "OTHER"] as const;

/**
 * Shared card-form: used by /cards (its own dialog) and /accounts (when the
 * user picks "Card" as the account kind). Always POSTs to /api/cards which
 * creates the Card and its companion Account in one go.
 */
export function CardForm({
  card,
  onSaved,
  onCancel,
}: {
  card: CardSnapshot | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { data: accountsData } = useSWR<{ accounts: BankAccountRow[] }>(
    "/api/accounts",
    fetcher
  );
  const bankAccounts = (accountsData?.accounts ?? []).filter((a) => a.kind === "BANK");

  const [name, setName] = useState("");
  const [kind, setKind] = useState<"DEBIT" | "CREDIT">("CREDIT");
  const [network, setNetwork] = useState<CardSnapshot["network"]>("VISA");
  const [supportsUpi, setSupportsUpi] = useState(false);
  const [last4, setLast4] = useState("");
  const [parentAccountId, setParentAccountId] = useState("");
  const [creditLimit, setCreditLimit] = useState("");
  const [statementDate, setStatementDate] = useState("");
  const [gracePeriod, setGracePeriod] = useState("");
  const [limitMode, setLimitMode] = useState<"SOLO" | "SHARED">("SOLO");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- reset on card change */
    setName(card?.name ?? "");
    setKind(card?.kind ?? "CREDIT");
    setNetwork(card?.network ?? "VISA");
    setSupportsUpi(card?.supportsUpi ?? false);
    setLast4(card?.last4 ?? "");
    setParentAccountId(card?.parentAccount?.id ?? "");
    setCreditLimit(card?.creditLimit != null ? String(card.creditLimit) : "");
    setStatementDate("");
    setGracePeriod("");
    setLimitMode(card?.limitMode ?? "SOLO");
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [card]);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        name,
        kind,
        network,
        supportsUpi,
        last4: last4 ? last4.slice(-4) : null,
        parentAccountId: kind === "DEBIT" ? parentAccountId || null : null,
        limitMode,
      };
      if (kind === "CREDIT") {
        payload.creditLimit = creditLimit ? Number(creditLimit) : null;
        payload.statementDate = statementDate ? Number(statementDate) : null;
        payload.gracePeriod = gracePeriod ? Number(gracePeriod) : null;
      }
      const res = await fetch(card ? `/api/cards/${card.id}` : "/api/cards", {
        method: card ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Failed");
        return;
      }
      globalMutate("/api/cards");
      globalMutate("/api/accounts");
      mutateBalances();
      onSaved();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="text-xs font-medium">Name</span>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          maxLength={80}
          placeholder="e.g. ICICI Amazon Pay"
        />
      </label>
      <div>
        <span className="text-xs font-medium block mb-2">Kind</span>
        <div className="flex gap-2">
          <Button
            type="button"
            variant={kind === "CREDIT" ? "default" : "outline"}
            onClick={() => setKind("CREDIT")}
          >
            Credit
          </Button>
          <Button
            type="button"
            variant={kind === "DEBIT" ? "default" : "outline"}
            onClick={() => setKind("DEBIT")}
          >
            Debit
          </Button>
        </div>
      </div>
      <label className="block">
        <span className="text-xs font-medium">Network</span>
        <select
          className="w-full rounded border border-input bg-background px-2 py-2 text-sm mt-1"
          value={network}
          onChange={(e) => setNetwork(e.target.value as CardSnapshot["network"])}
        >
          {NETWORKS.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={supportsUpi}
          onChange={(e) => setSupportsUpi(e.target.checked)}
        />
        <span className="text-sm">Supports UPI (typical for Rupay credit cards)</span>
      </label>
      <label className="block">
        <span className="text-xs font-medium">Last 4 digits</span>
        <Input
          value={last4}
          onChange={(e) => setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))}
          maxLength={4}
        />
      </label>
      {kind === "DEBIT" ? (
        <label className="block">
          <span className="text-xs font-medium">Linked bank account</span>
          <select
            className="w-full rounded border border-input bg-background px-2 py-2 text-sm mt-1"
            value={parentAccountId}
            onChange={(e) => setParentAccountId(e.target.value)}
          >
            <option value="">— choose —</option>
            {bankAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <>
          <label className="block">
            <span className="text-xs font-medium">Credit limit (₹)</span>
            <AmountInput value={creditLimit} onChange={setCreditLimit}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium">Statement day</span>
              <Input
                type="number"
                min={1}
                max={31}
                value={statementDate}
                onChange={(e) => setStatementDate(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium">Grace (days)</span>
              <Input
                type="number"
                min={0}
                value={gracePeriod}
                onChange={(e) => setGracePeriod(e.target.value)}
              />
            </label>
          </div>
          <div>
            <span className="text-xs font-medium block mb-2">Limit mode</span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={limitMode === "SOLO" ? "default" : "outline"}
                onClick={() => setLimitMode("SOLO")}
              >
                Solo
              </Button>
              <Button
                type="button"
                variant={limitMode === "SHARED" ? "default" : "outline"}
                onClick={() => setLimitMode("SHARED")}
              >
                Shared
              </Button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Shared = sub-card that draws on a parent card&apos;s limit.
            </p>
          </div>
        </>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2 justify-end pt-1">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={submitting || !name.trim()}>
          {card ? "Save card" : "Create card"}
        </Button>
      </div>
    </div>
  );
}
