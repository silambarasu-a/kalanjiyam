"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import useSWR, { mutate as globalMutate } from "swr";
import { toast } from "sonner";
import { Plus, LineChart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AmountInput } from "@/components/ui/amount-input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { mutateBalances } from "@/lib/mutate-balances";
import { formatINR, formatDate } from "@/lib/utils";
import { MoneyValue, ToneBadge } from "@/components/ui/money-tone";

type Investment = {
  id: string;
  kind: "STOCK" | "FD" | "MUTUAL_FUND" | "SIP" | "INSURANCE" | "OTHER";
  name: string;
  institution: string | null;
  amount: number;
  currentValue: number | null;
  interestRate: number | null;
  startedAt: string;
  maturityAt: string | null;
  active: boolean;
  symbol: string | null;
  quantity: number | null;
  policyNumber: string | null;
  premiumAmount: number | null;
  premiumFrequency: string | null;
  nextDueDate: string | null;
};

type Account = { id: string; name: string; kind: string };

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const KIND_OPTIONS: { value: Investment["kind"]; label: string }[] = [
  { value: "STOCK", label: "Stock" },
  { value: "MUTUAL_FUND", label: "Mutual fund" },
  { value: "SIP", label: "SIP" },
  { value: "FD", label: "Fixed deposit" },
  { value: "INSURANCE", label: "Insurance" },
  { value: "OTHER", label: "Other" },
];

export default function InvestmentsPage() {
  const [kindFilter, setKindFilter] = useState<"ALL" | Investment["kind"]>("ALL");
  const url =
    kindFilter === "ALL" ? "/api/investments" : `/api/investments?kind=${kindFilter}`;
  const { data, isLoading } = useSWR<{ investments: Investment[] }>(url, fetcher);
  const [editOpen, setEditOpen] = useState<"new" | null>(null);

  const investments = data?.investments ?? [];
  const totalInvested = investments.reduce((s, i) => s + i.amount, 0);
  const totalCurrent = investments.reduce(
    (s, i) => s + (i.currentValue ?? i.amount),
    0
  );
  const unrealised = totalCurrent - totalInvested;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Investments</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Stocks, mutual funds, SIPs, FDs, and insurance. {investments.length} active
            holding{investments.length === 1 ? "" : "s"}
            {totalInvested > 0 ? ` · ${formatINR(totalInvested)} invested` : ""}.
          </p>
        </div>
        <Button onClick={() => setEditOpen("new")} className="gap-2">
          <Plus className="h-4 w-4" /> New investment
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Invested" value={formatINR(totalInvested)} />
        <Stat label="Current value" value={formatINR(totalCurrent)} />
        <Stat
          label="Unrealised"
          value={`${unrealised >= 0 ? "+" : "−"}${formatINR(Math.abs(unrealised))}`}
          tone={unrealised >= 0 ? "primary" : "destructive"}
        />
        <Stat label="Holdings" value={String(investments.length)} />
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {(["ALL", ...KIND_OPTIONS.map((k) => k.value)] as const).map((k) => (
          <Button
            key={k}
            size="sm"
            variant={kindFilter === k ? "default" : "outline"}
            onClick={() => setKindFilter(k as typeof kindFilter)}
          >
            {k === "ALL" ? "All" : KIND_OPTIONS.find((o) => o.value === k)?.label ?? k}
          </Button>
        ))}
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {investments.map((i) => (
          <Link
            key={i.id}
            href={`/investments/${i.id}`}
            className="rounded-xl border bg-card p-5 hover:bg-accent/40 transition"
          >
            <div className="flex items-start gap-3">
              <LineChart className="h-5 w-5 mt-0.5 text-sky-600 dark:text-sky-400 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold truncate">{i.name}</span>
                  <ToneBadge tone="invested" label={i.kind} />
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground truncate">
                  {i.institution ? `${i.institution} · ` : ""}
                  {i.symbol ? `${i.symbol} · ` : ""}
                  {i.quantity != null ? `${i.quantity} units · ` : ""}
                  {i.premiumFrequency ? `${i.premiumFrequency} premium` : ""}
                </div>
              </div>
              <div className="text-right">
                <div className="font-semibold tabular-nums">
                  {formatINR(i.currentValue ?? i.amount)}
                </div>
                {i.currentValue != null && i.currentValue !== i.amount && (
                  <MoneyValue
                    tone={i.currentValue > i.amount ? "gain" : "loss"}
                    value={`${i.currentValue > i.amount ? "+" : "−"}${formatINR(Math.abs(i.currentValue - i.amount))}`}
                    className="text-[11px] mt-0.5"
                    iconClassName="h-3 w-3"
                  />
                )}
              </div>
            </div>
            {i.nextDueDate && (
              <div className="mt-2 text-xs text-muted-foreground">
                Next due {formatDate(i.nextDueDate)}
                {i.premiumAmount ? ` · ${formatINR(i.premiumAmount)}` : ""}
              </div>
            )}
          </Link>
        ))}
        {investments.length === 0 && !isLoading && (
          <div className="col-span-full rounded-xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
            No investments yet. Add stocks, SIPs, FDs, or insurance to start tracking.
          </div>
        )}
      </div>

      <CreateInvestmentDialog open={editOpen !== null} onClose={() => setEditOpen(null)} />
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "primary" | "destructive";
}) {
  const color =
    tone === "primary"
      ? "text-primary"
      : tone === "destructive"
        ? "text-destructive"
        : "text-foreground";
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 text-xl font-semibold ${color}`}>{value}</div>
    </div>
  );
}

function CreateInvestmentDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const { data: accountsData } = useSWR<{ accounts: Account[] }>("/api/accounts", fetcher);
  const accounts = (accountsData?.accounts ?? []).filter((a) => a.kind !== "CARD");

  const [kind, setKind] = useState<Investment["kind"]>("SIP");
  const [name, setName] = useState("");
  const [institution, setInstitution] = useState("");
  const [amount, setAmount] = useState("");
  const [interestRate, setInterestRate] = useState("");
  const [startedAt, setStartedAt] = useState(today);
  const [maturityAt, setMaturityAt] = useState("");
  const [symbol, setSymbol] = useState("");
  const [quantity, setQuantity] = useState("");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [policyNumber, setPolicyNumber] = useState("");
  const [premiumAmount, setPremiumAmount] = useState("");
  const [premiumFrequency, setPremiumFrequency] = useState("MONTHLY");
  const [nextDueDate, setNextDueDate] = useState("");
  const [sumAssured, setSumAssured] = useState("");
  const [accountId, setAccountId] = useState("");
  const [isExisting, setIsExisting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- reset on open */
    setKind("SIP");
    setName("");
    setInstitution("");
    setAmount("");
    setInterestRate("");
    setStartedAt(today);
    setMaturityAt("");
    setSymbol("");
    setQuantity("");
    setPurchasePrice("");
    setPolicyNumber("");
    setPremiumAmount("");
    setPremiumFrequency("MONTHLY");
    setNextDueDate("");
    setSumAssured("");
    setAccountId("");
    setIsExisting(false);
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, today]);

  async function submit() {
    setError(null);
    const amt = Number(amount);
    if (!amt || amt <= 0) return setError("Enter an amount");
    if (!name.trim()) return setError("Enter a name");
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        kind,
        name,
        institution: institution.trim() || undefined,
        amount: amt,
        interestRate: interestRate ? Number(interestRate) : null,
        startedAt,
        maturityAt: maturityAt || null,
        accountId: accountId || null,
        isExisting,
      };
      if (kind === "STOCK" || kind === "MUTUAL_FUND" || kind === "SIP") {
        payload.symbol = symbol.trim() || undefined;
        payload.quantity = quantity ? Number(quantity) : null;
        payload.purchasePrice = purchasePrice ? Number(purchasePrice) : null;
      }
      if (kind === "SIP") {
        payload.premiumAmount = premiumAmount ? Number(premiumAmount) : amt;
        payload.premiumFrequency = premiumFrequency;
        payload.nextDueDate = nextDueDate || null;
      }
      if (kind === "INSURANCE") {
        payload.policyNumber = policyNumber.trim() || undefined;
        payload.premiumAmount = premiumAmount ? Number(premiumAmount) : null;
        payload.premiumFrequency = premiumFrequency;
        payload.nextDueDate = nextDueDate || null;
        payload.sumAssured = sumAssured ? Number(sumAssured) : null;
      }
      const res = await fetch("/api/investments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Failed");
        return;
      }
      toast.success("Investment added");
      globalMutate((k) => typeof k === "string" && k.startsWith("/api/investments"));
      globalMutate("/api/reminders?status=UPCOMING");
      globalMutate("/api/dashboard/summary");
      await mutateBalances();
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  const showQty = kind === "STOCK" || kind === "MUTUAL_FUND" || kind === "SIP";
  const showPremium = kind === "SIP" || kind === "INSURANCE";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>New investment</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <span className="text-xs font-medium block mb-2">Kind</span>
            <div className="flex flex-wrap gap-2">
              {KIND_OPTIONS.map((k) => (
                <Button
                  key={k.value}
                  type="button"
                  size="sm"
                  variant={kind === k.value ? "default" : "outline"}
                  onClick={() => setKind(k.value)}
                >
                  {k.label}
                </Button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium">Name</span>
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
            </label>
            <label className="block">
              <span className="text-xs font-medium">Institution</span>
              <Input
                value={institution}
                onChange={(e) => setInstitution(e.target.value)}
                placeholder="Zerodha, HDFC, LIC…"
                maxLength={120}
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium">
                {kind === "FD" ? "Principal (₹)" : "Amount invested (₹)"}
              </span>
              <AmountInput value={amount} onChange={setAmount}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium">Started on</span>
              <Input
                type="date"
                value={startedAt}
                onChange={(e) => setStartedAt(e.target.value)}
              />
            </label>
          </div>
          {(kind === "FD" || kind === "SIP" || kind === "OTHER") && (
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-medium">Interest rate (% p.a.)</span>
                <AmountInput value={interestRate} onChange={setInterestRate}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium">Maturity date</span>
                <Input
                  type="date"
                  value={maturityAt}
                  onChange={(e) => setMaturityAt(e.target.value)}
                />
              </label>
            </div>
          )}
          {showQty && (
            <div className="grid grid-cols-3 gap-3">
              <label className="block">
                <span className="text-xs font-medium">Symbol</span>
                <Input value={symbol} onChange={(e) => setSymbol(e.target.value)} maxLength={40} />
              </label>
              <label className="block">
                <span className="text-xs font-medium">Quantity</span>
                <AmountInput value={quantity} onChange={setQuantity}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium">Price/unit</span>
                <AmountInput value={purchasePrice} onChange={setPurchasePrice}
                />
              </label>
            </div>
          )}
          {kind === "INSURANCE" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-medium">Policy number</span>
                  <Input
                    value={policyNumber}
                    onChange={(e) => setPolicyNumber(e.target.value)}
                    maxLength={80}
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium">Sum assured (₹)</span>
                  <AmountInput value={sumAssured} onChange={setSumAssured}
                  />
                </label>
              </div>
            </>
          )}
          {showPremium && (
            <div className="grid grid-cols-3 gap-3">
              <label className="block">
                <span className="text-xs font-medium">Premium (₹)</span>
                <AmountInput value={premiumAmount} onChange={setPremiumAmount}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium">Frequency</span>
                <select
                  className="w-full rounded border border-input bg-background px-2 py-2 text-sm mt-1"
                  value={premiumFrequency}
                  onChange={(e) => setPremiumFrequency(e.target.value)}
                >
                  <option value="MONTHLY">Monthly</option>
                  <option value="QUARTERLY">Quarterly</option>
                  <option value="HALF_YEARLY">Half-yearly</option>
                  <option value="YEARLY">Yearly</option>
                  <option value="ONE_TIME">One-time</option>
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-medium">Next due</span>
                <Input
                  type="date"
                  value={nextDueDate}
                  onChange={(e) => setNextDueDate(e.target.value)}
                />
              </label>
            </div>
          )}
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={isExisting}
              onChange={(e) => setIsExisting(e.target.checked)}
            />
            <span className="text-sm">Already owned (don&apos;t create a buy transaction)</span>
          </label>
          {!isExisting && (
            <label className="block">
              <span className="text-xs font-medium">Paid from (bank / cash)</span>
              <select
                className="w-full rounded border border-input bg-background px-2 py-2 text-sm mt-1"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
              >
                <option value="">— pick —</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "Saving…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
