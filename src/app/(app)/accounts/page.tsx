"use client";
import { toast } from "sonner";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR, { mutate as globalMutate } from "swr";
import { Plus, Pencil, Trash2, Wallet, Banknote, CreditCard, Smartphone, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AmountInput } from "@/components/ui/amount-input";
import { BankPicker } from "@/components/ui/bank-picker";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CardForm } from "@/components/cards/card-form";
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
  ownerContact: { id: string; name: string } | null;
  sharedWithUserIds: string[];
  availableLimit: number | null;
  upcomingBillAmount: number | null;
  nextBillDue: string | null;
  linkedCardId: string | null;
};

const KIND_ORDER: Account["kind"][] = ["BANK", "CASH", "WALLET", "CARD"];

type DialogMode = null | { kind: "new" } | { kind: "newCard" } | { kind: "edit"; account: Account };

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const KIND_META = {
  BANK: { label: "Bank", Icon: Banknote },
  CASH: { label: "Cash", Icon: Wallet },
  CARD: { label: "Card", Icon: CreditCard },
  WALLET: { label: "Wallet", Icon: Smartphone },
};

export default function AccountsPage() {
  const { data, isLoading } = useSWR<{ accounts: Account[] }>("/api/accounts", fetcher);
  const [dialog, setDialog] = useState<DialogMode>(null);

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
        <Button onClick={() => setDialog({ kind: "new" })} className="gap-2">
          <Plus className="h-4 w-4" /> New account
        </Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {(() => {
        const accounts = (data?.accounts ?? []).filter((a) => a.active);
        if (accounts.length === 0) return null;

        const cashAccounts = accounts.filter((a) => a.kind !== "CARD");
        const cardAccounts = accounts.filter((a) => a.kind === "CARD");

        const availableBalance = cashAccounts.reduce((s, a) => s + a.balance, 0);
        // Skip SHARED sub-cards (creditLimit on the companion is null when
        // the limit lives on the parent's pool) so we don't double-count.
        const cardsWithOwnLimit = cardAccounts.filter((a) => a.creditLimit != null);
        const totalLimit = cardsWithOwnLimit.reduce(
          (s, a) => s + (a.creditLimit ?? 0),
          0,
        );
        const totalAvailable = cardsWithOwnLimit.reduce(
          (s, a) => s + (a.availableLimit ?? a.creditLimit ?? 0),
          0,
        );
        const totalOutstanding = Math.max(0, totalLimit - totalAvailable);
        const totalDue = cardAccounts.reduce(
          (s, a) => s + (a.upcomingBillAmount ?? 0),
          0,
        );

        return (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <SummaryStat
              label="Available balance"
              value={formatINR(availableBalance)}
              tone={availableBalance > 0 ? "gain" : "muted"}
              hint={`${cashAccounts.length} bank/cash/wallet`}
            />
            <SummaryStat
              label="Available limit"
              value={cardsWithOwnLimit.length === 0 ? "—" : formatINR(totalAvailable)}
              tone={cardsWithOwnLimit.length === 0 ? "muted" : "gain"}
              hint={
                cardsWithOwnLimit.length === 0
                  ? "No credit cards"
                  : `of ${formatINR(totalLimit)}`
              }
            />
            <SummaryStat
              label="Outstanding"
              value={cardsWithOwnLimit.length === 0 ? "—" : formatINR(totalOutstanding)}
              tone={totalOutstanding > 0 ? "loss" : "muted"}
              hint={totalOutstanding > 0 ? "Limit in use" : "Nothing in use"}
            />
            <SummaryStat
              label="Total due"
              value={cardAccounts.length === 0 ? "—" : formatINR(totalDue)}
              tone={totalDue > 0 ? "loss" : "muted"}
              hint={totalDue > 0 ? "Across upcoming bills" : "Nothing pending"}
            />
          </div>
        );
      })()}

      {(() => {
        const accounts = data?.accounts ?? [];
        if (accounts.length === 0 && !isLoading) {
          return (
            <div className="rounded-lg border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
              No accounts yet. Add your bank, cash, or credit card to start tracking.
            </div>
          );
        }
        const grouped = KIND_ORDER.map((kind) => ({
          kind,
          items: accounts.filter((a) => a.kind === kind),
        })).filter((g) => g.items.length > 0);

        return (
          <div className="space-y-6">
            {grouped.map(({ kind, items }) => {
              const { label, Icon } = KIND_META[kind];
              return (
                <section key={kind} className="space-y-3">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    <Icon className="h-3.5 w-3.5" />
                    <span>{label}</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium normal-case tracking-normal text-muted-foreground">
                      {items.length}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                    {items.map((a) => (
                      <AccountCard
                        key={a.id}
                        account={a}
                        onEdit={() => setDialog({ kind: "edit", account: a })}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        );
      })()}

      <AccountDialog
        mode={dialog}
        onClose={() => setDialog(null)}
        onSwitchToCard={() => setDialog({ kind: "newCard" })}
      />
    </div>
  );
}

function AccountDialog({
  mode,
  onClose,
  onSwitchToCard,
}: {
  mode: DialogMode;
  onClose: () => void;
  onSwitchToCard: () => void;
}) {
  const account = mode?.kind === "edit" ? mode.account : null;
  const showCardForm = mode?.kind === "newCard";

  const [name, setName] = useState(""); // free-form (CASH/WALLET) or read-only assembled (BANK)
  const [bankName, setBankName] = useState(""); // BankPicker value
  const [bankTag, setBankTag] = useState(""); // optional suffix, e.g. "Savings"
  const [kind, setKind] = useState<"BANK" | "CASH" | "WALLET">("BANK");
  const [opening, setOpening] = useState("0");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!mode) return;
    /* eslint-disable react-hooks/set-state-in-effect -- reset on dialog open */
    const nextKind = (account?.kind === "CARD" ? "BANK" : account?.kind) ?? "BANK";
    setKind(nextKind);
    const existingName = account?.name ?? "";
    setName(existingName);
    if (nextKind === "BANK" && existingName) {
      // Try to split "BankName · Tag" back into pieces. If no "·" separator,
      // treat the whole string as the bank name (BankPicker enters Other mode).
      const sep = existingName.indexOf(" · ");
      if (sep !== -1) {
        setBankName(existingName.slice(0, sep));
        setBankTag(existingName.slice(sep + 3));
      } else {
        setBankName(existingName);
        setBankTag("");
      }
    } else {
      setBankName("");
      setBankTag("");
    }
    setOpening(String(account?.openingBalance ?? 0));
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [mode, account]);

  // For BANK kind, the assembled name is "BankName" or "BankName · Tag".
  const assembledName =
    kind === "BANK"
      ? bankTag.trim()
        ? `${bankName.trim()} · ${bankTag.trim()}`
        : bankName.trim()
      : name.trim();

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const payload = {
        name: assembledName,
        kind,
        openingBalance: Number(opening) || 0,
      };
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
    <Dialog open={mode !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {showCardForm ? "New card" : account ? "Edit account" : "New account"}
          </DialogTitle>
        </DialogHeader>

        {showCardForm ? (
          <CardForm card={null} onSaved={onClose} onCancel={onClose} />
        ) : (
          <>
            <div className="space-y-3">
              {kind === "BANK" ? (
                <>
                  <label className="block">
                    <span className="text-xs font-medium">Bank</span>
                    <BankPicker
                      value={bankName}
                      onChange={setBankName}
                      autoFocus
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium">
                      Account label{" "}
                      <span className="text-muted-foreground font-normal">
                        (optional, e.g. Savings, Salary, Joint)
                      </span>
                    </span>
                    <Input
                      value={bankTag}
                      onChange={(e) => setBankTag(e.target.value)}
                      maxLength={40}
                      placeholder="Savings"
                    />
                  </label>
                </>
              ) : (
                <label className="block">
                  <span className="text-xs font-medium">Name</span>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoFocus
                    maxLength={80}
                    placeholder={
                      kind === "WALLET" ? "e.g. PhonePe wallet" : "e.g. Cash on hand"
                    }
                  />
                </label>
              )}
              <div>
                <span className="text-xs font-medium block mb-2">Kind</span>
                <div className="flex flex-wrap gap-2">
                  {(["BANK", "CASH", "WALLET"] as const).map((k) => (
                    <Button
                      key={k}
                      type="button"
                      variant={kind === k ? "default" : "outline"}
                      onClick={() => setKind(k)}
                    >
                      {KIND_META[k].label}
                    </Button>
                  ))}
                  {!account && (
                    <Button type="button" variant="outline" onClick={onSwitchToCard}>
                      <CreditCard className="h-4 w-4" /> Card…
                    </Button>
                  )}
                </div>
                {!account && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Adding a card opens the full card form (network, UPI, limit, statement day).
                  </p>
                )}
              </div>
              <label className="block">
                <span className="text-xs font-medium">Opening balance (₹)</span>
                <AmountInput value={opening} onChange={setOpening}
                />
              </label>
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={submitting || !assembledName}>
                {account ? "Save" : "Create"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SummaryStat({
  label,
  value,
  hint,
  tone = "muted",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "muted" | "gain" | "loss";
}) {
  const valueClass =
    tone === "gain"
      ? "text-emerald-700 dark:text-emerald-400"
      : tone === "loss"
        ? "text-destructive"
        : "";
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${valueClass}`}>
        {value}
      </div>
      {hint && (
        <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>
      )}
    </div>
  );
}

function AccountCard({
  account: a,
  onEdit,
}: {
  account: Account;
  onEdit: () => void;
}) {
  const router = useRouter();
  const [navigating, setNavigating] = useState(false);
  const { Icon, label } = KIND_META[a.kind];
  const isCard = a.kind === "CARD";
  const showLimit = isCard && a.creditLimit != null;
  const avail = a.availableLimit ?? a.creditLimit ?? 0;
  const limitPct =
    showLimit && a.creditLimit && a.creditLimit > 0 ? avail / a.creditLimit : 1;
  const limitTone = limitPct > 0.5 ? "gain" : limitPct > 0.2 ? "outstanding" : "loss";
  // CARD-kind accounts open the card detail page (richer view); other
  // kinds open the per-account ledger.
  const href =
    isCard && a.linkedCardId ? `/cards/${a.linkedCardId}` : `/accounts/${a.id}`;
  const go = () => {
    setNavigating(true);
    router.push(href);
  };

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={() => navigating || go()}
      onKeyDown={(e) => {
        if (navigating) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          go();
        }
      }}
      aria-label={`Open ${a.name}`}
      aria-busy={navigating}
      className="relative cursor-pointer rounded-lg border bg-card p-5 flex flex-col gap-3 transition-colors hover:bg-muted/30 focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
            <h3 className="truncate font-semibold">{a.name}</h3>
          </div>
          <div className="mt-0.5 text-xs uppercase tracking-wider text-muted-foreground">
            {label}
            {a.ownerContact ? ` · ${a.ownerContact.name}` : ""}
          </div>
        </div>
        <div className="flex gap-1">
          {!isCard && (
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
              aria-label="Edit"
            >
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={async (e) => {
              e.stopPropagation();
              if (!confirm(`Delete ${a.name}?`)) return;
              const res = await fetch(`/api/accounts/${a.id}`, { method: "DELETE" });
              if (!res.ok) {
                const body = await res.json();
                toast.error(body.error ?? "Failed");
              }
              globalMutate("/api/accounts");
            }}
            aria-label="Delete"
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </div>

      {showLimit ? (
        <div>
          <div className="text-xs text-muted-foreground">Available limit</div>
          <div
            className={
              "text-2xl font-semibold tabular-nums " +
              (limitTone === "gain"
                ? "text-emerald-700 dark:text-emerald-400"
                : limitTone === "outstanding"
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-destructive")
            }
          >
            {formatINR(avail)}
          </div>
          <div className="mt-1.5 h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div
              className={
                limitTone === "gain"
                  ? "h-full bg-primary"
                  : limitTone === "outstanding"
                    ? "h-full bg-amber-500"
                    : "h-full bg-destructive"
              }
              style={{ width: `${Math.max(0, Math.min(100, limitPct * 100))}%` }}
            />
          </div>
          <div className="mt-1 flex items-center justify-between text-xs">
            <span className="text-muted-foreground tabular-nums">
              of {formatINR(a.creditLimit ?? 0)}
            </span>
            {a.upcomingBillAmount != null && a.upcomingBillAmount > 0 ? (
              <span className="font-medium text-destructive tabular-nums">
                Due {formatINR(a.upcomingBillAmount)}
                {a.nextBillDue && (
                  <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">
                    by {new Date(a.nextBillDue).toLocaleDateString("en-IN")}
                  </span>
                )}
              </span>
            ) : a.balance > 0 ? (
              <span className="text-muted-foreground tabular-nums">
                Spend {formatINR(a.balance)}
              </span>
            ) : (
              <span className="text-muted-foreground">No dues</span>
            )}
          </div>
        </div>
      ) : (
        <div>
          <div className="text-xs text-muted-foreground">Balance</div>
          <div
            className={
              "text-2xl font-semibold tabular-nums " +
              (a.balance > 0
                ? "text-emerald-700 dark:text-emerald-400"
                : a.balance < 0
                  ? "text-destructive"
                  : "")
            }
          >
            {formatINR(a.balance)}
          </div>
        </div>
      )}

      {isCard && (
        <div className="text-xs">
          <Link
            href="/cards"
            onClick={(e) => e.stopPropagation()}
            className="text-primary hover:underline"
          >
            manage card →
          </Link>
        </div>
      )}
      {navigating && (
        <div
          className="absolute inset-0 z-20 flex items-center justify-center rounded-lg bg-card/70 backdrop-blur-[1px]"
          aria-hidden
        >
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}
    </div>
  );
}
