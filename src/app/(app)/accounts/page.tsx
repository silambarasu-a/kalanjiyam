"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import useSWR, { mutate as globalMutate } from "swr";
import { Plus, Pencil, Trash2, Wallet, Banknote, CreditCard, Smartphone } from "lucide-react";
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

type Account = {
  id: string;
  kind: "BANK" | "CASH" | "CARD" | "WALLET";
  name: string;
  openingBalance: number;
  balance: number;
  creditLimit: number | null;
  statementDate: number | null;
  gracePeriod: number | null;
  active: boolean;
  ownerUser: { id: string; name: string; email: string } | null;
  ownerMember: { id: string; name: string } | null;
  sharedWithUserIds: string[];
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const KIND_META = {
  BANK: { label: "Bank", Icon: Banknote },
  CASH: { label: "Cash", Icon: Wallet },
  CARD: { label: "Card", Icon: CreditCard },
  WALLET: { label: "Wallet", Icon: Smartphone },
};

export default function AccountsPage() {
  const { data, isLoading } = useSWR<{ accounts: Account[] }>("/api/accounts", fetcher);
  const [editOpen, setEditOpen] = useState<Account | "new" | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Accounts</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Bank accounts, cash wallets, and card-linked accounts. Balances update as you record
            transactions.
          </p>
        </div>
        <Button onClick={() => setEditOpen("new")} className="gap-2">
          <Plus className="h-4 w-4" /> New account
        </Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {(data?.accounts ?? []).map((a) => {
          const { Icon, label } = KIND_META[a.kind];
          return (
            <div key={a.id} className="rounded-lg border bg-card p-5 flex flex-col gap-3">
              <div className="flex items-start justify-between gap-3">
                <Link href={`/accounts/${a.id}`} className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                    <h3 className="truncate font-semibold">{a.name}</h3>
                  </div>
                  <div className="mt-0.5 text-xs uppercase tracking-wider text-muted-foreground">
                    {label}
                    {a.ownerMember ? ` · ${a.ownerMember.name}` : ""}
                  </div>
                </Link>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setEditOpen(a)}
                    aria-label="Edit"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={async () => {
                      if (!confirm(`Delete ${a.name}?`)) return;
                      const res = await fetch(`/api/accounts/${a.id}`, { method: "DELETE" });
                      if (!res.ok) {
                        const body = await res.json();
                        alert(body.error ?? "Failed");
                      }
                      globalMutate("/api/accounts");
                    }}
                    aria-label="Delete"
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Balance</div>
                <div className="text-2xl font-semibold">{formatINR(a.balance)}</div>
              </div>
              {a.kind === "CARD" && a.creditLimit != null && (
                <div className="text-xs text-muted-foreground">
                  Credit limit: {formatINR(a.creditLimit)}
                </div>
              )}
            </div>
          );
        })}
        {(data?.accounts ?? []).length === 0 && !isLoading && (
          <div className="col-span-full rounded-lg border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
            No accounts yet. Add your bank, cash, or credit card to start tracking.
          </div>
        )}
      </div>

      <AccountDialog
        account={editOpen === "new" ? null : (editOpen as Account | null)}
        open={editOpen !== null}
        onClose={() => setEditOpen(null)}
      />
    </div>
  );
}

function AccountDialog({
  account,
  open,
  onClose,
}: {
  account: Account | null;
  open: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Account["kind"]>("BANK");
  const [opening, setOpening] = useState("0");
  const [creditLimit, setCreditLimit] = useState("");
  const [statementDate, setStatementDate] = useState("");
  const [gracePeriod, setGracePeriod] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- reset form state on dialog open. */
    setName(account?.name ?? "");
    setKind(account?.kind ?? "BANK");
    setOpening(String(account?.openingBalance ?? 0));
    setCreditLimit(account?.creditLimit != null ? String(account.creditLimit) : "");
    setStatementDate(account?.statementDate != null ? String(account.statementDate) : "");
    setGracePeriod(account?.gracePeriod != null ? String(account.gracePeriod) : "");
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, account]);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        name,
        kind,
        openingBalance: Number(opening) || 0,
      };
      if (kind === "CARD") {
        payload.creditLimit = creditLimit ? Number(creditLimit) : null;
        payload.statementDate = statementDate ? Number(statementDate) : null;
        payload.gracePeriod = gracePeriod ? Number(gracePeriod) : null;
      }
      const res = await fetch(account ? `/api/accounts/${account.id}` : "/api/accounts", {
        method: account ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) setError(body.error ?? "Failed");
      else {
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
          <DialogTitle>{account ? "Edit account" : "New account"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs font-medium">Name</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={80} />
          </label>
          <div>
            <span className="text-xs font-medium block mb-2">Kind</span>
            <div className="flex flex-wrap gap-2">
              {(["BANK", "CASH", "CARD", "WALLET"] as const).map((k) => (
                <Button
                  key={k}
                  type="button"
                  variant={kind === k ? "default" : "outline"}
                  onClick={() => setKind(k)}
                >
                  {KIND_META[k].label}
                </Button>
              ))}
            </div>
          </div>
          <label className="block">
            <span className="text-xs font-medium">Opening balance (₹)</span>
            <Input
              type="number"
              inputMode="decimal"
              value={opening}
              onChange={(e) => setOpening(e.target.value)}
            />
          </label>
          {kind === "CARD" && (
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
                  <span className="text-xs font-medium">Statement day (1-31)</span>
                  <Input
                    type="number"
                    min={1}
                    max={31}
                    value={statementDate}
                    onChange={(e) => setStatementDate(e.target.value)}
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium">Grace period (days)</span>
                  <Input
                    type="number"
                    min={0}
                    value={gracePeriod}
                    onChange={(e) => setGracePeriod(e.target.value)}
                  />
                </label>
              </div>
            </>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={submitting || !name.trim()}>
            {account ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
