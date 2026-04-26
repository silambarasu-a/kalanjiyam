"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import useSWR, { mutate as globalMutate } from "swr";
import { toast } from "sonner";
import { Plus, LineChart, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { AmountInput } from "@/components/ui/amount-input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  PercentOrRupeeInput,
  resolveAmount,
} from "@/components/ui/percent-or-rupee-input";
import { GoldBreakdown } from "@/components/investments/gold-breakdown";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { mutateBalances } from "@/lib/mutate-balances";
import { formatINR, formatDate, buildAccountOption } from "@/lib/utils";
import { MoneyValue, ToneBadge } from "@/components/ui/money-tone";

type Investment = {
  id: string;
  kind: "STOCK" | "FD" | "RD" | "MUTUAL_FUND" | "SIP" | "INSURANCE" | "GOLD" | "OTHER";
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

type Account = {
  id: string;
  name: string;
  kind: string;
  balance: number;
  availableLimit: number | null;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const KIND_OPTIONS: { value: Investment["kind"]; label: string }[] = [
  { value: "STOCK", label: "Stock" },
  { value: "MUTUAL_FUND", label: "Mutual fund" },
  { value: "SIP", label: "SIP" },
  { value: "FD", label: "Fixed deposit" },
  { value: "RD", label: "Recurring deposit" },
  { value: "INSURANCE", label: "Insurance" },
  { value: "GOLD", label: "Gold" },
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
        <div className="flex gap-2">
          <Link
            href="/investments/stocks"
            className="inline-flex items-center gap-2 rounded-lg border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors"
          >
            <TrendingUp className="h-4 w-4" /> Stocks portfolio
          </Link>
          <Button onClick={() => setEditOpen("new")} className="gap-2">
            <Plus className="h-4 w-4" /> New investment
          </Button>
        </div>
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
  // INSURANCE extras
  const [policyType, setPolicyType] = useState("LIFE");
  const [nominee, setNominee] = useState("");
  // GOLD extras (stored in metadata + reused typed fields: quantity = grams, purchasePrice = rate/g)
  const [goldType, setGoldType] = useState<"ORNAMENTS" | "BAR" | "COIN" | "SGB" | "DIGITAL" | "ETF">(
    "ORNAMENTS",
  );
  const [goldPurity, setGoldPurity] = useState("22K");
  const [goldWastage, setGoldWastage] = useState("");
  const [goldWastageMode, setGoldWastageMode] = useState<"RUPEE" | "PERCENT">("PERCENT");
  const [goldMaking, setGoldMaking] = useState("");
  const [goldMakingMode, setGoldMakingMode] = useState<"RUPEE" | "PERCENT">("PERCENT");
  const [goldGst, setGoldGst] = useState("");
  // GST defaults to %: India levies 3% on gold (1.5% CGST + 1.5% SGST).
  const [goldGstMode, setGoldGstMode] = useState<"RUPEE" | "PERCENT">("PERCENT");
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
    setPolicyType("LIFE");
    setNominee("");
    setGoldType("ORNAMENTS");
    setGoldPurity("22K");
    setGoldWastage("");
    setGoldWastageMode("PERCENT");
    setGoldMaking("");
    setGoldMakingMode("PERCENT");
    setGoldGst("");
    setGoldGstMode("PERCENT");
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
      if (kind === "SIP" || kind === "RD") {
        payload.premiumAmount = premiumAmount ? Number(premiumAmount) : amt;
        payload.premiumFrequency = premiumFrequency;
        payload.nextDueDate = nextDueDate || null;
      }
      if (kind === "INSURANCE") {
        payload.policyNumber = policyNumber.trim() || undefined;
        payload.policyType = policyType;
        payload.nominee = nominee.trim() || undefined;
        payload.premiumAmount = premiumAmount ? Number(premiumAmount) : null;
        payload.premiumFrequency = premiumFrequency;
        payload.nextDueDate = nextDueDate || null;
        payload.sumAssured = sumAssured ? Number(sumAssured) : null;
      }
      if (kind === "GOLD") {
        // Reuse typed columns: quantity = weight (g), purchasePrice = rate/g.
        const w = parseFloat(quantity) || 0;
        const r = parseFloat(purchasePrice) || 0;
        const goldValue = w * r;
        const wastageAmt = resolveAmount(goldWastage, goldWastageMode, goldValue);
        const makingAmt = resolveAmount(goldMaking, goldMakingMode, goldValue);
        // GST applies on (gold value + making + wastage) per Indian rules.
        const gstAmt = resolveAmount(goldGst, goldGstMode, goldValue + wastageAmt + makingAmt);
        payload.quantity = quantity ? w : null;
        payload.purchasePrice = purchasePrice ? r : null;
        payload.metadata = {
          goldType,
          purity: goldPurity,
          wastage: wastageAmt || null,
          wastageInput: goldWastage || null,
          wastageMode: goldWastageMode,
          making: makingAmt || null,
          makingInput: goldMaking || null,
          makingMode: goldMakingMode,
          gst: gstAmt || null,
          gstInput: goldGst || null,
          gstMode: goldGstMode,
        };
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
  const showPremium = kind === "SIP" || kind === "INSURANCE" || kind === "RD";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(36rem,calc(100%-2rem))]">
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium">
                {kind === "FD" ? "Principal (₹)" : "Amount invested (₹)"}
              </span>
              <AmountInput value={amount} onChange={setAmount}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium">Started on</span>
              <DateInput
                value={startedAt}
                onChange={(e) => setStartedAt(e.target.value)}
              />
            </label>
          </div>
          {(kind === "FD" || kind === "RD" || kind === "SIP" || kind === "OTHER") && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-medium">Interest rate (% p.a.)</span>
                <AmountInput value={interestRate} onChange={setInterestRate}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium">Maturity date</span>
                <DateInput
                  value={maturityAt}
                  onChange={(e) => setMaturityAt(e.target.value)}
                />
              </label>
            </div>
          )}
          {showQty && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
          {kind === "GOLD" && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-medium">Type</span>
                  <div className="mt-1">
                    <NativeSelect
                      value={goldType}
                      onChange={(v) => setGoldType(v as typeof goldType)}
                      options={[
                        { value: "ORNAMENTS", label: "Ornaments / Jewellery" },
                        { value: "BAR", label: "Bar / Bullion" },
                        { value: "COIN", label: "Coin" },
                        { value: "SGB", label: "Sovereign Gold Bond" },
                        { value: "DIGITAL", label: "Digital gold" },
                        { value: "ETF", label: "Gold ETF" },
                      ]}
                    />
                  </div>
                </label>
                <label className="block">
                  <span className="text-xs font-medium">Purity</span>
                  <div className="mt-1">
                    <NativeSelect
                      value={goldPurity}
                      onChange={setGoldPurity}
                      options={[
                        { value: "24K", label: "24K (999.9)" },
                        { value: "22K", label: "22K (916)" },
                        { value: "18K", label: "18K (750)" },
                        { value: "14K", label: "14K (585)" },
                        { value: "OTHER", label: "Other" },
                      ]}
                    />
                  </div>
                </label>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-medium">Weight (g)</span>
                  <AmountInput value={quantity} onChange={setQuantity} placeholder="0" />
                </label>
                <label className="block">
                  <span className="text-xs font-medium">Rate per gram (₹)</span>
                  <AmountInput
                    value={purchasePrice}
                    onChange={setPurchasePrice}
                    placeholder="0"
                  />
                </label>
              </div>
              {(() => {
                const w = parseFloat(quantity);
                const r = parseFloat(purchasePrice);
                const goldValue = w > 0 && r > 0 ? w * r : 0;
                const ws = resolveAmount(goldWastage, goldWastageMode, goldValue);
                const mk = resolveAmount(goldMaking, goldMakingMode, goldValue);
                const gstBase = goldValue + ws + mk;
                const gst = resolveAmount(goldGst, goldGstMode, gstBase);
                return (
                  <>
                    {goldType === "ORNAMENTS" ? (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <label className="block">
                          <span className="text-xs font-medium">Wastage</span>
                          <PercentOrRupeeInput
                            value={goldWastage}
                            onValueChange={setGoldWastage}
                            mode={goldWastageMode}
                            onModeChange={setGoldWastageMode}
                            baseAmount={goldValue}
                          />
                        </label>
                        <label className="block">
                          <span className="text-xs font-medium">Making</span>
                          <PercentOrRupeeInput
                            value={goldMaking}
                            onValueChange={setGoldMaking}
                            mode={goldMakingMode}
                            onModeChange={setGoldMakingMode}
                            baseAmount={goldValue}
                          />
                        </label>
                        <label className="block">
                          <span className="text-xs font-medium">GST</span>
                          <PercentOrRupeeInput
                            value={goldGst}
                            onValueChange={setGoldGst}
                            mode={goldGstMode}
                            onModeChange={setGoldGstMode}
                            baseAmount={gstBase}
                          />
                        </label>
                      </div>
                    ) : (
                      <label className="block">
                        <span className="text-xs font-medium">GST</span>
                        <PercentOrRupeeInput
                          value={goldGst}
                          onValueChange={setGoldGst}
                          mode={goldGstMode}
                          onModeChange={setGoldGstMode}
                          baseAmount={gstBase}
                        />
                      </label>
                    )}
                    {goldValue > 0 && (
                      <GoldBreakdown
                        weight={w}
                        ratePerGram={r}
                        goldValue={goldValue}
                        wastage={ws}
                        making={mk}
                        gst={gst}
                        showWastage={goldType === "ORNAMENTS"}
                        showMaking={goldType === "ORNAMENTS"}
                        onUseTotal={(total) => setAmount(String(Math.round(total)))}
                      />
                    )}
                  </>
                );
              })()}
            </>
          )}
          {kind === "INSURANCE" && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-medium">Policy type</span>
                  <div className="mt-1">
                    <NativeSelect
                      value={policyType}
                      onChange={setPolicyType}
                      options={[
                        { value: "LIFE", label: "Life" },
                        { value: "TERM", label: "Term" },
                        { value: "HEALTH", label: "Health" },
                        { value: "ENDOWMENT", label: "Endowment" },
                        { value: "ULIP", label: "ULIP" },
                        { value: "VEHICLE", label: "Vehicle" },
                        { value: "HOME", label: "Home" },
                        { value: "TRAVEL", label: "Travel" },
                        { value: "OTHER", label: "Other" },
                      ]}
                    />
                  </div>
                </label>
                <label className="block">
                  <span className="text-xs font-medium">Nominee</span>
                  <Input
                    value={nominee}
                    onChange={(e) => setNominee(e.target.value)}
                    maxLength={120}
                    placeholder="Optional"
                  />
                </label>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="block">
                <span className="text-xs font-medium">Premium (₹)</span>
                <AmountInput value={premiumAmount} onChange={setPremiumAmount}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium">Frequency</span>
                <div className="mt-1">
                  <NativeSelect
                    value={premiumFrequency}
                    onChange={setPremiumFrequency}
                    options={[
                      { value: "MONTHLY", label: "Monthly" },
                      { value: "QUARTERLY", label: "Quarterly" },
                      { value: "HALF_YEARLY", label: "Half-yearly" },
                      { value: "YEARLY", label: "Yearly" },
                      { value: "ONE_TIME", label: "One-time" },
                    ]}
                  />
                </div>
              </label>
              <label className="block">
                <span className="text-xs font-medium">Next due</span>
                <DateInput
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
              <div className="mt-1">
                <NativeSelect
                  value={accountId}
                  onChange={setAccountId}
                  options={accounts.map((a) => buildAccountOption(a, Number(amount) || 0))}
                />
              </div>
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
