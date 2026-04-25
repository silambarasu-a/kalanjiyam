"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import useSWR, { mutate as globalMutate } from "swr";
import { Plus, Pencil, Trash2, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatINR } from "@/lib/utils";

type Card = {
  id: string;
  name: string;
  kind: "DEBIT" | "CREDIT";
  network: "VISA" | "MASTERCARD" | "RUPAY" | "AMEX" | "DINERS" | "OTHER";
  supportsUpi: boolean;
  last4: string | null;
  limitMode: "SOLO" | "SHARED";
  active: boolean;
  ownerUser: { id: string; name: string } | null;
  ownerMember: { id: string; name: string } | null;
  parentAccount: { id: string; name: string } | null;
  accountId: string | null;
  creditLimit: number | null;
  availableLimit: number | null;
  sharedWithUserIds: string[];
};

type BankAccountRow = { id: string; name: string; kind: string };

const fetcher = (url: string) => fetch(url).then((r) => r.json());
const NETWORKS = ["VISA", "MASTERCARD", "RUPAY", "AMEX", "DINERS", "OTHER"] as const;

export default function CardsPage() {
  const { data, isLoading } = useSWR<{ cards: Card[] }>("/api/cards", fetcher);
  const { data: accounts } = useSWR<{ accounts: BankAccountRow[] }>("/api/accounts", fetcher);
  const [editOpen, setEditOpen] = useState<Card | "new" | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Cards</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Debit and credit cards. Credit cards track statement spend and show your available
            limit (creditLimit − active EMI principal − current statement spend).
          </p>
        </div>
        <Button onClick={() => setEditOpen("new")} className="gap-2">
          <Plus className="h-4 w-4" /> New card
        </Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {(data?.cards ?? []).map((c) => (
          <div key={c.id} className="rounded-lg border bg-card p-5 flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
              <Link href={`/cards/${c.id}`} className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-muted-foreground" />
                  <h3 className="truncate font-semibold">{c.name}</h3>
                </div>
                <div className="mt-0.5 text-xs uppercase tracking-wider text-muted-foreground">
                  {c.kind} · {c.network}
                  {c.supportsUpi ? " · UPI" : ""}
                  {c.last4 ? ` · ••${c.last4}` : ""}
                </div>
              </Link>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setEditOpen(c)}
                  aria-label="Edit"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={async () => {
                    if (!confirm(`Delete ${c.name}?`)) return;
                    const res = await fetch(`/api/cards/${c.id}`, { method: "DELETE" });
                    if (!res.ok) {
                      const body = await res.json();
                      alert(body.error ?? "Failed");
                    }
                    globalMutate("/api/cards");
                  }}
                  aria-label="Delete"
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
            {c.kind === "CREDIT" && c.creditLimit != null && (
              <div>
                <div className="text-xs text-muted-foreground">Available limit</div>
                <div className="text-2xl font-semibold">
                  {formatINR(c.availableLimit ?? c.creditLimit)}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  of {formatINR(c.creditLimit)} total
                </div>
              </div>
            )}
            {c.kind === "DEBIT" && c.parentAccount && (
              <div className="text-xs text-muted-foreground">
                Linked to {c.parentAccount.name}
              </div>
            )}
          </div>
        ))}
        {(data?.cards ?? []).length === 0 && !isLoading && (
          <div className="col-span-full rounded-lg border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
            No cards yet. Add your debit or credit cards for UPI payments and EMI tracking.
          </div>
        )}
      </div>

      <CardDialog
        card={editOpen === "new" ? null : (editOpen as Card | null)}
        accounts={(accounts?.accounts ?? []).filter((a) => a.kind === "BANK")}
        open={editOpen !== null}
        onClose={() => setEditOpen(null)}
      />
    </div>
  );
}

function CardDialog({
  card,
  accounts,
  open,
  onClose,
}: {
  card: Card | null;
  accounts: BankAccountRow[];
  open: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"DEBIT" | "CREDIT">("CREDIT");
  const [network, setNetwork] = useState<Card["network"]>("VISA");
  const [supportsUpi, setSupportsUpi] = useState(false);
  const [last4, setLast4] = useState("");
  const [parentAccountId, setParentAccountId] = useState<string>("");
  const [creditLimit, setCreditLimit] = useState("");
  const [statementDate, setStatementDate] = useState("");
  const [gracePeriod, setGracePeriod] = useState("");
  const [limitMode, setLimitMode] = useState<"SOLO" | "SHARED">("SOLO");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- reset form state on dialog open. */
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
  }, [open, card]);

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
      if (!res.ok) setError(body.error ?? "Failed");
      else {
        globalMutate("/api/cards");
        globalMutate("/api/accounts");
        onClose();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{card ? "Edit card" : "New card"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs font-medium">Name</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={80} />
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
              onChange={(e) => setNetwork(e.target.value as Card["network"])}
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
                {accounts.map((a) => (
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
                <Input
                  type="number"
                  inputMode="decimal"
                  value={creditLimit}
                  onChange={(e) => setCreditLimit(e.target.value)}
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
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={submitting || !name.trim()}>
            {card ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
