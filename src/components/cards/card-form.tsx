"use client";

import { useEffect, useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AmountInput } from "@/components/ui/amount-input";
import { BankPicker } from "@/components/ui/bank-picker";
import { NativeSelect } from "@/components/ui/native-select";
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
  parentCard?: { id: string; name: string } | null;
  creditLimit: number | null;
  statementDate: number | null;
  gracePeriod: number | null;
};

type BankAccountRow = { id: string; name: string; kind: string };

type CardRow = {
  id: string;
  name: string;
  kind: "DEBIT" | "CREDIT";
  network: CardSnapshot["network"];
  supportsUpi: boolean;
  limitMode: "SOLO" | "SHARED";
  creditLimit: number | null;
};

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
  const { data: cardsData } = useSWR<{ cards: CardRow[] }>("/api/cards", fetcher);
  const bankAccounts = (accountsData?.accounts ?? []).filter((a) => a.kind === "BANK");
  // Eligible parents: any other CREDIT card in the workspace that isn't itself
  // a SHARED sub-card (we don't allow grandchildren).
  const parentCandidates = (cardsData?.cards ?? []).filter(
    (c) => c.kind === "CREDIT" && c.limitMode !== "SHARED" && c.id !== card?.id,
  );

  const [issuer, setIssuer] = useState("");
  const [variant, setVariant] = useState("");
  const [kind, setKind] = useState<"DEBIT" | "CREDIT">("CREDIT");
  const [network, setNetwork] = useState<CardSnapshot["network"]>("VISA");
  const [supportsUpi, setSupportsUpi] = useState(false);
  const [last4, setLast4] = useState("");
  const [parentAccountId, setParentAccountId] = useState("");
  const [parentCardId, setParentCardId] = useState("");
  const [creditLimit, setCreditLimit] = useState("");
  const [openingBalance, setOpeningBalance] = useState("");
  const [statementDate, setStatementDate] = useState("");
  const [gracePeriod, setGracePeriod] = useState("");
  const [limitMode, setLimitMode] = useState<"SOLO" | "SHARED">("SOLO");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- reset on card change */
    const existing = card?.name ?? "";
    if (existing) {
      const sep = existing.indexOf(" · ");
      if (sep !== -1) {
        setIssuer(existing.slice(0, sep));
        setVariant(existing.slice(sep + 3));
      } else {
        setIssuer(existing);
        setVariant("");
      }
    } else {
      setIssuer("");
      setVariant("");
    }
    setKind(card?.kind ?? "CREDIT");
    setNetwork(card?.network ?? "VISA");
    setSupportsUpi(card?.supportsUpi ?? false);
    setLast4(card?.last4 ?? "");
    setParentAccountId(card?.parentAccount?.id ?? "");
    setParentCardId(card?.parentCard?.id ?? "");
    setCreditLimit(card?.creditLimit != null ? String(card.creditLimit) : "");
    setOpeningBalance("");
    setStatementDate(card?.statementDate != null ? String(card.statementDate) : "");
    setGracePeriod(card?.gracePeriod != null ? String(card.gracePeriod) : "");
    setLimitMode(card?.limitMode ?? "SOLO");
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [card]);

  const assembledName = variant.trim()
    ? `${issuer.trim()} · ${variant.trim()}`
    : issuer.trim();

  function applyParent(p: CardRow) {
    setParentCardId(p.id);
    // Split parent's name on " · " — left side is issuer, right side variant.
    const sep = p.name.indexOf(" · ");
    if (sep !== -1) {
      setIssuer(p.name.slice(0, sep));
    } else {
      setIssuer(p.name);
    }
    setNetwork(p.network);
    setSupportsUpi(p.supportsUpi);
    if (p.creditLimit != null) setCreditLimit(String(p.creditLimit));
  }

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const isSharedChild = kind === "CREDIT" && limitMode === "SHARED";
      const payload: Record<string, unknown> = {
        name: assembledName,
        kind,
        network,
        supportsUpi,
        last4: last4 ? last4.slice(-4) : null,
        parentAccountId: kind === "DEBIT" ? parentAccountId || null : null,
        parentCardId: isSharedChild ? parentCardId || null : null,
        limitMode,
      };
      if (kind === "CREDIT") {
        // SHARED sub-cards inherit the limit from their parent — don't send
        // an own creditLimit (the API would otherwise overwrite it to null).
        if (!isSharedChild) {
          payload.creditLimit = creditLimit ? Number(creditLimit) : null;
        }
        payload.statementDate = statementDate ? Number(statementDate) : null;
        payload.gracePeriod = gracePeriod ? Number(gracePeriod) : null;
        // Opening outstanding only applies when creating a new card.
        if (!card && openingBalance) {
          payload.openingBalance = Number(openingBalance);
        }
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
        <span className="text-xs font-medium">Issuer</span>
        <BankPicker value={issuer} onChange={setIssuer} autoFocus />
      </label>
      <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
        <label className="block">
          <span className="text-xs font-medium">
            Card variant{" "}
            <span className="text-muted-foreground font-normal">(optional)</span>
          </span>
          <Input
            value={variant}
            onChange={(e) => setVariant(e.target.value)}
            maxLength={60}
            placeholder="Amazon Pay"
          />
        </label>
        <div>
          <span className="text-xs font-medium block">Kind</span>
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
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
        <label className="block">
          <span className="text-xs font-medium">Network</span>
          <div className="mt-1">
            <NativeSelect
              value={network}
              onChange={(next) => setNetwork(next as CardSnapshot["network"])}
              options={NETWORKS.map((n) => ({ value: n, label: n }))}
            />
          </div>
        </label>
        <label className="flex items-center gap-2 h-9">
          <input
            type="checkbox"
            checked={supportsUpi}
            onChange={(e) => setSupportsUpi(e.target.checked)}
          />
          <span className="text-sm">Supports UPI</span>
        </label>
      </div>
      {kind === "DEBIT" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-medium">Last 4 digits</span>
            <Input
              value={last4}
              onChange={(e) => setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))}
              maxLength={4}
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium">Linked bank account</span>
            <div className="mt-1">
              <NativeSelect
                value={parentAccountId}
                onChange={setParentAccountId}
                placeholder="— choose —"
                options={bankAccounts.map((a) => ({ value: a.id, label: a.name }))}
              />
            </div>
          </label>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium">Last 4 digits</span>
              <Input
                value={last4}
                onChange={(e) => setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))}
                maxLength={4}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium">
                Credit limit (₹)
                {limitMode === "SHARED" && (
                  <span className="text-muted-foreground font-normal"> (from parent)</span>
                )}
              </span>
              <AmountInput
                value={creditLimit}
                onChange={setCreditLimit}
                disabled={limitMode === "SHARED"}
              />
            </label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
          {!card && (
            <label className="block">
              <span className="text-xs font-medium">
                Existing outstanding (₹){" "}
                <span className="text-muted-foreground font-normal">(optional)</span>
              </span>
              <AmountInput
                value={openingBalance}
                onChange={setOpeningBalance}
                placeholder="0"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                {limitMode === "SHARED"
                  ? "Existing spend on this sub-card. It rolls up to the parent's pool, reducing the shared available limit."
                  : "If you already owe a balance on this card, enter it here. It seeds the opening balance so your statement and available limit start correctly."}
              </p>
            </label>
          )}
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
                onClick={() => {
                  setLimitMode("SHARED");
                  // If only one eligible parent exists, pre-pick it so the
                  // user immediately sees inherited issuer/limit.
                  if (!parentCardId && parentCandidates.length === 1) {
                    applyParent(parentCandidates[0]);
                  }
                }}
                disabled={parentCandidates.length === 0}
              >
                Shared
              </Button>
            </div>
            {limitMode === "SHARED" ? (
              <div className="mt-2">
                <label className="block">
                  <span className="text-xs font-medium">Parent card</span>
                  <div className="mt-1">
                    <NativeSelect
                      value={parentCardId}
                      onChange={(id) => {
                        setParentCardId(id);
                        const p = parentCandidates.find((c) => c.id === id);
                        if (p) applyParent(p);
                      }}
                      placeholder="— choose —"
                      options={parentCandidates.map((c) => ({
                        value: c.id,
                        label: c.creditLimit
                          ? `${c.name} · ₹${c.creditLimit.toLocaleString("en-IN")}`
                          : c.name,
                      }))}
                    />
                  </div>
                </label>
                <p className="mt-1 text-xs text-muted-foreground">
                  Issuer, network, and credit limit are inherited from the parent.
                </p>
              </div>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">
                {parentCandidates.length === 0
                  ? "Add a Solo credit card first to enable Shared sub-cards."
                  : "Shared = sub-card that draws on a parent card's limit."}
              </p>
            )}
          </div>
        </>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2 justify-end pt-1">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={submitting || !assembledName}>
          {card ? "Save card" : "Create card"}
        </Button>
      </div>
    </div>
  );
}
