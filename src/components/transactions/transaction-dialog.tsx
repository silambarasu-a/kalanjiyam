"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight, LineChart, HandCoins, RefreshCw } from "lucide-react";
import type { StockQuote } from "@/app/api/market/quote/route";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { AmountInput } from "@/components/ui/amount-input";
import { NativeSelect, type NativeSelectGroup } from "@/components/ui/native-select";
import {
  PercentOrRupeeInput,
  resolveAmount,
} from "@/components/ui/percent-or-rupee-input";
import { GoldBreakdown } from "@/components/investments/gold-breakdown";
import { HoldingPicker } from "@/components/investments/holding-picker";
import { SymbolSearch } from "@/components/investments/symbol-search";
import { InsurancePremiumBreakdown } from "@/components/investments/insurance-premium-breakdown";
import { BankPicker } from "@/components/ui/bank-picker";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn, formatINR, buildAccountOption } from "@/lib/utils";
import { mutateBalances } from "@/lib/mutate-balances";
import {
  useTransactionDialog,
  type TransactionDefault,
} from "@/contexts/transaction-dialog";

type Account = {
  id: string;
  name: string;
  kind: "BANK" | "CASH" | "CARD" | "WALLET";
  balance: number;
  availableLimit: number | null;
};
type Card = {
  id: string;
  name: string;
  kind: "DEBIT" | "CREDIT";
  accountId: string | null;
  availableLimit: number | null;
};
type Category = {
  id: string;
  name: string;
  group: string | null;
  types: string[];
};
type FamilyMember = { id: string; name: string };
type Worker = { id: string; name: string; dailyRate: number | null; balance: number };
type CropBatch = {
  id: string;
  name: string;
  status: string;
  crop: { id: string; name: string };
};
type LivestockBatch = {
  id: string;
  name: string;
  currentCount: number;
  livestock: { id: string; name: string };
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());
type ChargeFlag = "NONE" | "RECOVERABLE" | "GIFT";

const TABS: { value: TransactionDefault; label: string; icon: React.ElementType; disabled?: boolean }[] = [
  { value: "INCOME", label: "Income", icon: ArrowDownLeft },
  { value: "EXPENSE", label: "Expense", icon: ArrowUpRight },
  { value: "TRANSFER", label: "Transfer", icon: ArrowLeftRight },
  { value: "HAND_LOAN", label: "Hand loan", icon: HandCoins },
  { value: "INVESTMENT", label: "Invest", icon: LineChart },
];

export function TransactionDialog() {
  const { open, defaultType, closeDialog } = useTransactionDialog();
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    /* eslint-disable react-hooks/set-state-in-effect -- one-shot sync to media-query state */
    setIsMobile(mq.matches);
    /* eslint-enable react-hooks/set-state-in-effect */
    const listener = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", listener);
    return () => mq.removeEventListener("change", listener);
  }, []);

  const body = (
    <DialogBody key={open ? "open" : "closed"} defaultType={defaultType} onClose={closeDialog} />
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={(o) => !o && closeDialog()}>
        <SheetContent side="bottom">
          <SheetHeader>
            <SheetTitle>New transaction</SheetTitle>
          </SheetHeader>
          {body}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeDialog()}>
      <DialogContent className="w-[min(36rem,calc(100%-2rem))]">
        <DialogHeader>
          <DialogTitle>New transaction</DialogTitle>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}

function DialogBody({
  defaultType,
  onClose,
}: {
  defaultType: TransactionDefault;
  onClose: () => void;
}) {
  const [type, setType] = useState<TransactionDefault>(defaultType);
  const { data: accountsData } = useSWR<{ accounts: Account[] }>("/api/accounts", fetcher);
  const { data: cardsData } = useSWR<{ cards: Card[] }>("/api/cards", fetcher);
  const { data: categoriesData } = useSWR<{ categories: Category[] }>(
    type === "INCOME" || type === "EXPENSE"
      ? `/api/categories?type=${type}`
      : null,
    fetcher
  );
  const { data: familyData } = useSWR<{ members: FamilyMember[] }>("/api/family", fetcher);
  const { data: cropBatchesData } = useSWR<{ batches: CropBatch[] }>(
    "/api/crop-batches?active=true",
    fetcher
  );
  const { data: livestockBatchesData } = useSWR<{ batches: LivestockBatch[] }>(
    "/api/livestock-batches?active=true",
    fetcher
  );
  const { data: workersData } = useSWR<{ workers: Worker[] }>(
    type === "EXPENSE" ? "/api/workers" : null,
    fetcher,
  );
  const { data: investmentCategoriesData } = useSWR<{ categories: Category[] }>(
    type === "INVESTMENT" ? "/api/categories?type=INVESTMENT" : null,
    fetcher,
  );

  const accounts = accountsData?.accounts ?? [];
  const cards = (cardsData?.cards ?? []).filter((c) => c.kind === "CREDIT" && c.accountId);
  const categories = categoriesData?.categories ?? [];
  const investmentCategories = investmentCategoriesData?.categories ?? [];
  const family = familyData?.members ?? [];
  const cropBatches = cropBatchesData?.batches ?? [];
  const livestockBatches = livestockBatchesData?.batches ?? [];
  const workers = (workersData?.workers ?? []).filter((w) => w);

  return (
    <div>
      <div className="flex gap-1 rounded-md bg-muted p-1 mb-4">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = type === tab.value;
          return (
            <button
              key={tab.value}
              type="button"
              disabled={tab.disabled}
              onClick={() => !tab.disabled && setType(tab.value as TransactionDefault)}
              className={cn(
                "flex-1 min-w-0 flex flex-col items-center gap-0.5 rounded px-2 py-1.5 text-[11px] transition-colors",
                active ? "bg-white shadow text-foreground" : "text-muted-foreground",
                tab.disabled && "opacity-40 cursor-not-allowed"
              )}
              title={tab.disabled ? "Coming in a later milestone" : undefined}
            >
              <Icon className="h-4 w-4" />
              <span className="truncate">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {type === "TRANSFER" ? (
        <TransferForm accounts={accounts} onClose={onClose} />
      ) : type === "HAND_LOAN" ? (
        <HandLoanForm accounts={accounts} onClose={onClose} />
      ) : type === "INVESTMENT" ? (
        <InvestmentForm
          accounts={accounts}
          categories={investmentCategories}
          onClose={onClose}
        />
      ) : (
        <IncomeExpenseForm
          type={type}
          accounts={accounts}
          cards={cards}
          categories={categories}
          family={family}
          cropBatches={cropBatches}
          livestockBatches={livestockBatches}
          workers={workers}
          onClose={onClose}
        />
      )}
    </div>
  );
}

function IncomeExpenseForm({
  type,
  accounts,
  cards,
  categories,
  family,
  cropBatches,
  livestockBatches,
  workers,
  onClose,
}: {
  type: "INCOME" | "EXPENSE";
  accounts: Account[];
  cards: Card[];
  categories: Category[];
  family: FamilyMember[];
  cropBatches: CropBatch[];
  livestockBatches: LivestockBatch[];
  workers: Worker[];
  onClose: () => void;
}) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(today);
  const [categoryId, setCategoryId] = useState("");
  const [paymentSource, setPaymentSource] = useState<string>(""); // "account:<id>" or "card:<id>"
  const [beneficiaryMemberId, setBeneficiaryMemberId] = useState("");
  const [chargeFlag, setChargeFlag] = useState<ChargeFlag>("NONE");
  const [tagSource, setTagSource] = useState<string>(""); // "" | "crop:<id>" | "livestock:<id>"
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Wage-mode state — active when category.name === "Wage" on EXPENSE.
  const [workerIds, setWorkerIds] = useState<string[]>([]);
  const [splitMode, setSplitMode] = useState<"equal" | "custom">("equal");
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>({});

  const selectedCategory = categories.find((c) => c.id === categoryId);
  const isWageMode =
    type === "EXPENSE" && selectedCategory?.name?.toLowerCase() === "wage";

  const amtNum = parseFloat(amount) || 0;
  const sources = useMemo(() => {
    const items: { value: string; label: string; sub: string; disabled: boolean }[] = [];
    for (const a of accounts) {
      if (a.kind === "CARD") continue; // companion cards are surfaced via Cards
      const insufficient = type === "EXPENSE" && amtNum > 0 && amtNum > a.balance;
      items.push({
        value: `account:${a.id}`,
        label: a.name,
        sub: `${a.kind} · ${formatINR(a.balance)}`,
        disabled: insufficient,
      });
    }
    if (type === "EXPENSE") {
      for (const c of cards) {
        const avail = c.availableLimit;
        const insufficient = avail != null && amtNum > 0 && amtNum > avail;
        items.push({
          value: `card:${c.id}`,
          label: c.name,
          sub: `Credit · ${avail != null ? formatINR(avail) : "—"} avail`,
          disabled: insufficient,
        });
      }
    }
    return items;
  }, [accounts, cards, type, amtNum]);

  async function submit() {
    setError(null);
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      setError("Enter an amount");
      return;
    }
    if (!paymentSource) {
      setError("Pick an account or card");
      return;
    }
    const [kind, sid] = paymentSource.split(":");

    // Wage mode → fan out to /api/wage-payments, one call per worker.
    if (isWageMode) {
      if (workerIds.length === 0) {
        setError("Pick at least one worker");
        return;
      }
      const perWorker: Record<string, number> = {};
      if (splitMode === "equal") {
        const share = amt / workerIds.length;
        for (const wid of workerIds) perWorker[wid] = share;
      } else {
        let sum = 0;
        for (const wid of workerIds) {
          const v = parseFloat(customAmounts[wid] || "0") || 0;
          if (v <= 0) {
            setError("Enter an amount for every selected worker");
            return;
          }
          perWorker[wid] = v;
          sum += v;
        }
        if (Math.abs(sum - amt) > 0.01) {
          setError("Worker amounts must add up to the total");
          return;
        }
      }
      setSubmitting(true);
      try {
        const results = await Promise.all(
          workerIds.map((wid) =>
            fetch("/api/wage-payments", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                workerId: wid,
                amount: perWorker[wid],
                paidAt: date,
                accountId: kind === "account" ? sid : undefined,
                cardId: kind === "card" ? sid : undefined,
                notes: description.trim() || undefined,
              }),
            }).then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => null) })),
          ),
        );
        const failed = results.find((r) => !r.ok);
        if (failed) {
          setError(failed.body?.error ?? "One or more wage payments failed");
        } else {
          toast.success(`Paid ${workerIds.length} worker${workerIds.length === 1 ? "" : "s"}`);
          await mutateBalances();
          onClose();
        }
      } catch {
        setError("Network error");
      } finally {
        setSubmitting(false);
      }
      return;
    }

    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        type,
        amount: amt,
        description: description || (type === "INCOME" ? "Income" : "Expense"),
        date,
        categoryId: categoryId || null,
        accountId: kind === "account" ? sid : null,
        cardId: kind === "card" ? sid : null,
      };
      if (type === "EXPENSE" && beneficiaryMemberId) {
        payload.beneficiaryMemberId = beneficiaryMemberId;
        payload.memberChargeType = chargeFlag;
      }
      if (tagSource.startsWith("crop:")) payload.cropBatchId = tagSource.slice(5);
      if (tagSource.startsWith("livestock:")) payload.livestockBatchId = tagSource.slice(10);
      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Failed");
      } else {
        toast.success(type === "INCOME" ? "Income recorded" : "Expense recorded");
        await mutateBalances();
        onClose();
      }
    } catch {
      setError("Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-medium">Amount (₹)</span>
          <AmountInput value={amount} onChange={setAmount}
            placeholder="0"
            autoFocus
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium">Date</span>
          <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-medium">
            {type === "INCOME" ? "To account" : "Pay from"}
          </span>
          <div className="mt-1">
            <NativeSelect
              value={paymentSource}
              onChange={setPaymentSource}
              options={sources.map((s) => ({
                value: s.value,
                label: s.label,
                hint: s.sub,
                disabled: s.disabled,
              }))}
            />
          </div>
        </label>
        <label className="block">
          <span className="text-xs font-medium">Category</span>
          <div className="mt-1">
            <NativeSelect
              value={categoryId}
              onChange={setCategoryId}
              placeholder="— optional —"
              options={categories.map((c) => ({
                value: c.id,
                label: c.group ? `${c.group} · ${c.name}` : c.name,
              }))}
            />
          </div>
        </label>
      </div>

      {isWageMode && (
        <WorkersPanel
          workers={workers}
          totalAmount={amtNum}
          workerIds={workerIds}
          setWorkerIds={setWorkerIds}
          splitMode={splitMode}
          setSplitMode={setSplitMode}
          customAmounts={customAmounts}
          setCustomAmounts={setCustomAmounts}
        />
      )}

      {(cropBatches.length > 0 || livestockBatches.length > 0) && (
        <label className="block">
          <span className="text-xs font-medium">Tag to farm batch (optional)</span>
          <div className="mt-1">
            <NativeSelect
              value={tagSource}
              onChange={setTagSource}
              placeholder="— none —"
              options={
                [
                  cropBatches.length > 0 && {
                    label: "Crops",
                    options: cropBatches.map((b) => ({
                      value: `crop:${b.id}`,
                      label: `${b.crop.name} · ${b.name} (${b.status})`,
                    })),
                  },
                  livestockBatches.length > 0 && {
                    label: "Livestock",
                    options: livestockBatches.map((b) => ({
                      value: `livestock:${b.id}`,
                      label: `${b.livestock.name} · ${b.name} (${b.currentCount} head)`,
                    })),
                  },
                ].filter(Boolean) as NativeSelectGroup[]
              }
            />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Tags this transaction to a crop or livestock batch for per-batch P&amp;L.
          </p>
        </label>
      )}

      {type === "EXPENSE" && (
        <details className="rounded-md border bg-card">
          <summary className="cursor-pointer select-none px-4 py-2 text-sm">
            Spent for a family member?
          </summary>
          <div className="px-4 pb-4 pt-2 space-y-2">
            <NativeSelect
              value={beneficiaryMemberId}
              onChange={setBeneficiaryMemberId}
              placeholder="— pick member —"
              options={family.map((m) => ({ value: m.id, label: m.name }))}
            />
            {beneficiaryMemberId && (
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={chargeFlag === "RECOVERABLE"}
                  onChange={(e) =>
                    setChargeFlag(e.target.checked ? "RECOVERABLE" : "NONE")
                  }
                  className="mt-0.5 h-4 w-4 accent-primary"
                />
                <div className="space-y-0.5">
                  <span className="text-sm font-medium block">
                    Recover this from {family.find((m) => m.id === beneficiaryMemberId)?.name ?? "them"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {chargeFlag === "RECOVERABLE"
                      ? "Adds to their owed balance — settle later in the Member Ledger."
                      : "Just tagged for reporting; no balance impact."}
                  </span>
                </div>
              </label>
            )}
          </div>
        </details>
      )}

      <label className="block">
        <span className="text-xs font-medium">Description</span>
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={type === "INCOME" ? "What's it for?" : "What did you spend on?"}
          maxLength={200}
        />
      </label>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button
          onClick={submit}
          disabled={
            submitting ||
            (isWageMode && (workerIds.length === 0 || amtNum <= 0))
          }
        >
          {submitting
            ? "Saving…"
            : isWageMode
              ? `Pay ${workerIds.length || ""} worker${workerIds.length === 1 ? "" : "s"}`.trim()
              : `Save ${type === "INCOME" ? "income" : "expense"}`}
        </Button>
      </DialogFooter>
    </div>
  );
}

function WorkersPanel({
  workers,
  totalAmount,
  workerIds,
  setWorkerIds,
  splitMode,
  setSplitMode,
  customAmounts,
  setCustomAmounts,
}: {
  workers: Worker[];
  totalAmount: number;
  workerIds: string[];
  setWorkerIds: React.Dispatch<React.SetStateAction<string[]>>;
  splitMode: "equal" | "custom";
  setSplitMode: React.Dispatch<React.SetStateAction<"equal" | "custom">>;
  customAmounts: Record<string, string>;
  setCustomAmounts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}) {
  const sum = workerIds.reduce((s, wid) => s + (parseFloat(customAmounts[wid] || "0") || 0), 0);
  const diff = totalAmount - sum;
  const matches = Math.abs(diff) < 0.01;
  const equalShare = workerIds.length > 0 ? totalAmount / workerIds.length : 0;
  return (
    <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Workers
        </span>
        {workerIds.length > 0 && totalAmount > 0 && (
          <div className="flex gap-1">
            <Button
              type="button"
              size="xs"
              variant={splitMode === "equal" ? "default" : "outline"}
              onClick={() => {
                setSplitMode("equal");
                setCustomAmounts({});
              }}
            >
              Equal
            </Button>
            <Button
              type="button"
              size="xs"
              variant={splitMode === "custom" ? "default" : "outline"}
              onClick={() => setSplitMode("custom")}
            >
              Custom
            </Button>
          </div>
        )}
      </div>
      {workers.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No active workers. Add them from the Workers page.
        </p>
      ) : (
        <div className="rounded-md border bg-card divide-y max-h-56 overflow-y-auto">
          {workers.map((w) => {
            const checked = workerIds.includes(w.id);
            return (
              <label
                key={w.id}
                className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-accent/30"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() =>
                    setWorkerIds((prev) =>
                      checked ? prev.filter((id) => id !== w.id) : [...prev, w.id],
                    )
                  }
                  className="h-4 w-4 accent-primary"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{w.name}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {w.dailyRate ? `₹${w.dailyRate}/day` : "—"}
                    {w.balance > 0 && (
                      <span className="ml-2 text-rose-600">
                        owed {formatINR(w.balance)}
                      </span>
                    )}
                  </div>
                </div>
                {checked && splitMode === "custom" && (
                  <Input
                    type="number"
                    min={0}
                    value={customAmounts[w.id] ?? ""}
                    onChange={(e) =>
                      setCustomAmounts((prev) => ({ ...prev, [w.id]: e.target.value }))
                    }
                    placeholder="₹"
                    className="w-24 h-8"
                    onClick={(e) => e.stopPropagation()}
                  />
                )}
                {checked && splitMode === "equal" && (
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {formatINR(equalShare)}
                  </span>
                )}
              </label>
            );
          })}
        </div>
      )}
      {workerIds.length > 0 && totalAmount > 0 && splitMode === "custom" && (
        <div
          className={cn(
            "text-xs font-medium",
            matches ? "text-emerald-700" : "text-rose-600",
          )}
        >
          Total: {formatINR(sum)} / {formatINR(totalAmount)}
          {!matches &&
            ` (${diff > 0 ? `${formatINR(diff)} short` : `${formatINR(Math.abs(diff))} over`})`}
        </div>
      )}
    </div>
  );
}

function TransferForm({ accounts, onClose }: { accounts: Account[]; onClose: () => void }) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      setError("Enter an amount");
      return;
    }
    if (!fromId || !toId) {
      setError("Pick both accounts");
      return;
    }
    if (fromId === toId) {
      setError("From and to must differ");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/transfers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fromAccountId: fromId,
          toAccountId: toId,
          amount: amt,
          date,
          notes: notes.trim() || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Failed");
      } else {
        toast.success("Transfer recorded");
        await mutateBalances();
        onClose();
      }
    } finally {
      setSubmitting(false);
    }
  }

  const amtNum = parseFloat(amount) || 0;
  return (
    <div className="space-y-3">
      <label className="block">
        <span className="text-xs font-medium">From</span>
        <div className="mt-1">
          <NativeSelect
            value={fromId}
            onChange={setFromId}
            options={accounts.map((a) => buildAccountOption(a, amtNum))}
          />
        </div>
      </label>
      <label className="block">
        <span className="text-xs font-medium">To</span>
        <div className="mt-1">
          <NativeSelect
            value={toId}
            onChange={setToId}
            options={accounts
              .filter((a) => a.id !== fromId)
              .map((a) => buildAccountOption(a, 0))}
          />
        </div>
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-medium">Amount (₹)</span>
          <AmountInput value={amount} onChange={setAmount}
            placeholder="0"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium">Date</span>
          <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>
      <label className="block">
        <span className="text-xs font-medium">Notes</span>
        <Input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional"
          maxLength={500}
        />
      </label>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={submitting}>
          {submitting ? "Saving…" : "Save transfer"}
        </Button>
      </DialogFooter>
    </div>
  );
}

type HandLoanMember = { id: string; name: string; balance: number };

function HandLoanForm({ accounts, onClose }: { accounts: Account[]; onClose: () => void }) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const { data: membersData } = useSWR<{ members: HandLoanMember[] }>(
    "/api/hand-loan-members",
    fetcher
  );
  const members = membersData?.members ?? [];

  const [memberId, setMemberId] = useState("");
  const [newName, setNewName] = useState("");
  const [direction, setDirection] = useState<"GIVEN" | "RECEIVED">("GIVEN");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [accountId, setAccountId] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      setError("Enter an amount");
      return;
    }
    if (!accountId) {
      setError("Pick an account");
      return;
    }
    let resolvedMemberId = memberId;
    if (memberId === "NEW") {
      if (!newName.trim()) {
        setError("Enter a name or pick an existing person");
        return;
      }
    } else if (!memberId) {
      setError("Pick a person or create a new one");
      return;
    }
    setSubmitting(true);
    try {
      if (memberId === "NEW") {
        const createRes = await fetch("/api/hand-loan-members", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: newName.trim() }),
        });
        const createBody = await createRes.json();
        if (!createRes.ok) {
          setError(createBody.error ?? "Failed to create person");
          return;
        }
        resolvedMemberId = createBody.id;
      }
      const res = await fetch("/api/hand-loan-entries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          memberId: resolvedMemberId,
          direction,
          amount: amt,
          date,
          accountId,
          notes: notes.trim() || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Failed");
        return;
      }
      toast.success(direction === "GIVEN" ? "Hand loan given" : "Hand loan received");
      await mutateBalances();
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Button
          type="button"
          variant={direction === "GIVEN" ? "default" : "outline"}
          onClick={() => setDirection("GIVEN")}
          className="gap-1.5"
        >
          <ArrowUpRight className="h-4 w-4" /> I gave
        </Button>
        <Button
          type="button"
          variant={direction === "RECEIVED" ? "default" : "outline"}
          onClick={() => setDirection("RECEIVED")}
          className="gap-1.5"
        >
          <ArrowDownLeft className="h-4 w-4" /> I received
        </Button>
      </div>

      <label className="block">
        <span className="text-xs font-medium">Person</span>
        <div className="mt-1">
          <NativeSelect
            value={memberId}
            onChange={setMemberId}
            options={[
              ...members.map((m) => ({
                value: m.id,
                label:
                  m.name +
                  (m.balance !== 0
                    ? ` (${m.balance > 0 ? "owes" : "advanced"} ₹${Math.abs(m.balance).toLocaleString("en-IN")})`
                    : ""),
              })),
              { value: "NEW", label: "+ Add new person" },
            ]}
          />
        </div>
      </label>

      {memberId === "NEW" && (
        <label className="block">
          <span className="text-xs font-medium">Name</span>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Friend / relative"
            maxLength={80}
            autoFocus
          />
        </label>
      )}

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-medium">Amount (₹)</span>
          <AmountInput value={amount} onChange={setAmount}
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium">Date</span>
          <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>

      <label className="block">
        <span className="text-xs font-medium">
          {direction === "GIVEN" ? "Paid from" : "Received into"}
        </span>
        <div className="mt-1">
          <NativeSelect
            value={accountId}
            onChange={setAccountId}
            options={accounts.map((a) =>
              buildAccountOption(a, direction === "GIVEN" ? Number(amount) || 0 : 0),
            )}
          />
        </div>
      </label>

      <label className="block">
        <span className="text-xs font-medium">Notes</span>
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
      </label>

      <p className="text-xs text-muted-foreground">
        For formal hand loans (interest + EMI schedule), go to Hand loans → Formal loan.
      </p>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={submitting}>
          {submitting ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </div>
  );
}

/**
 * Map an investment category name (from the seeded "Investment" group) to
 * the canonical InvestmentKind enum value. Names that don't match any
 * mapping default to "OTHER".
 */
function categoryNameToKind(name: string): string {
  const n = name.trim().toUpperCase();
  if (n === "STOCK" || n === "STOCKS") return "STOCK";
  if (n === "MUTUAL FUND" || n === "MUTUAL FUNDS" || n === "MF") return "MUTUAL_FUND";
  if (n === "FD" || n === "FIXED DEPOSIT") return "FD";
  if (n === "RD" || n === "RECURRING DEPOSIT") return "RD";
  if (n === "SIP") return "SIP";
  if (n === "INSURANCE") return "INSURANCE";
  if (n === "GOLD") return "GOLD";
  return "OTHER";
}

type InvestmentHolding = {
  id: string;
  kind: string;
  name: string;
  symbol: string | null;
  exchange: string | null;
  currency: string | null;
  quantity: number | null;
  amount: number;
  active: boolean;
  // Optional fields used by InsurancePremiumBreakdown.
  institution?: string | null;
  premiumAmount?: number | null;
  premiumFrequency?: string | null;
  nextDueDate?: string | null;
};

function InvestmentForm({
  accounts,
  categories,
  onClose,
}: {
  accounts: Account[];
  categories: Category[];
  onClose: () => void;
}) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const { data: invData } = useSWR<{ investments: InvestmentHolding[] }>(
    "/api/investments",
    fetcher
  );
  const investments = (invData?.investments ?? []).filter((i) => i.active);

  const [investmentId, setInvestmentId] = useState("");
  const [action, setAction] = useState<"BUY" | "SELL">("BUY");
  const [amount, setAmount] = useState("");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [date, setDate] = useState(today);
  const [accountId, setAccountId] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchingPrice, setFetchingPrice] = useState(false);
  const [livePrice, setLivePrice] = useState<{ price: number; currency: string } | null>(null);

  // Create-new-holding mode (BUY only). When on, the picker is replaced by
  // kind/name/symbol fields and submit posts to /api/investments which
  // creates the holding + initial BUY transaction in one shot.
  const [creatingNew, setCreatingNew] = useState(false);
  const [newKind, setNewKind] = useState<
    "STOCK" | "MUTUAL_FUND" | "FD" | "RD" | "SIP" | "INSURANCE" | "GOLD" | "OTHER"
  >("STOCK");
  const [newName, setNewName] = useState("");
  const [newSymbol, setNewSymbol] = useState("");
  const [newExchange, setNewExchange] = useState("");
  // FD-specific
  const [newInstitution, setNewInstitution] = useState("");
  const [newInterestRate, setNewInterestRate] = useState("");
  const [newMaturityAt, setNewMaturityAt] = useState("");
  // INSURANCE-specific
  const [newPolicyNumber, setNewPolicyNumber] = useState("");
  const [newPremium, setNewPremium] = useState("");
  const [newPolicyType, setNewPolicyType] = useState("LIFE");
  const [newNominee, setNewNominee] = useState("");
  // GOLD-specific
  const [newGoldType, setNewGoldType] = useState<
    "ORNAMENTS" | "BAR" | "COIN" | "SGB" | "DIGITAL" | "ETF"
  >("ORNAMENTS");
  const [newGoldPurity, setNewGoldPurity] = useState("22K");
  const [newGoldWastage, setNewGoldWastage] = useState("");
  const [newGoldWastageMode, setNewGoldWastageMode] = useState<"RUPEE" | "PERCENT">("PERCENT");
  const [newGoldMaking, setNewGoldMaking] = useState("");
  const [newGoldMakingMode, setNewGoldMakingMode] = useState<"RUPEE" | "PERCENT">("PERCENT");
  const [newGoldGst, setNewGoldGst] = useState("");
  const [newGoldGstMode, setNewGoldGstMode] = useState<"RUPEE" | "PERCENT">("PERCENT");
  // Category chip
  const [categoryId, setCategoryId] = useState("");
  // Foreign-currency support (set automatically when a USD stock is picked).
  const [investmentCurrency, setInvestmentCurrency] = useState<"INR" | "USD">("INR");
  const [exchangeRate, setExchangeRate] = useState("");
  const [fetchingRate, setFetchingRate] = useState(false);

  const selected = investments.find((i) => i.id === investmentId) ?? null;
  const isStock =
    creatingNew ? newKind === "STOCK" : selected?.kind === "STOCK" && !!selected?.symbol;

  // Active symbol = picked holding's symbol OR (when creating new STOCK) the
  // symbol entered in the SymbolSearch.
  const activeSymbol = creatingNew
    ? newKind === "STOCK"
      ? newSymbol
      : null
    : (selected?.symbol ?? null);

  // Active kind drives chip highlight + USD label + button labels.
  // Picked holding wins; otherwise fall back to the kind set by the chip
  // selection (defaults to "STOCK" when nothing has been picked yet).
  const activeKind = selected?.kind ?? newKind;
  // Quantity × price only makes sense for unitised investments.
  const isQtyBased = activeKind === "STOCK" || activeKind === "MUTUAL_FUND" || activeKind === "SIP";

  // Holdings filtered to the active kind — drives the picker contents and
  // the auto-flip into create-new mode when nothing exists for that kind.
  const filteredHoldings = useMemo(
    () => investments.filter((i) => i.kind === activeKind),
    [investments, activeKind],
  );

  // Auto-flip to create-new mode when the user picks a kind chip that has
  // no existing holdings (typical for GOLD purchases, new FDs, new RDs).
  useEffect(() => {
    if (action !== "BUY") return;
    if (creatingNew) return;
    if (investmentId) return;
    if (filteredHoldings.length === 0 && newKind !== "STOCK") {
      // STOCK is excluded so opening the dialog with the default kind
      // doesn't immediately push the user into create-new before they
      // can react.
      setCreatingNew(true);
    }
  }, [action, creatingNew, investmentId, filteredHoldings.length, newKind]);

  // Live-price fetch — fires for both selected-holding and new-stock flows.
  // Also auto-flips currency to USD when the quote comes back in USD.
  useEffect(() => {
    setLivePrice(null);
    if (!isStock || !activeSymbol) return;
    let cancelled = false;
    setFetchingPrice(true);
    fetch(`/api/market/quote?symbols=${encodeURIComponent(activeSymbol)}`)
      .then((r) => r.json())
      .then((data: StockQuote[]) => {
        if (cancelled) return;
        const q = data?.[0];
        if (q && q.price > 0) {
          const cur = (q.currency || "INR") as "INR" | "USD";
          setLivePrice({ price: q.price, currency: cur });
          setInvestmentCurrency(cur === "USD" ? "USD" : "INR");
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setFetchingPrice(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isStock, activeSymbol]);

  // Auto-fetch USD → INR rate whenever foreign-currency mode is on.
  const isForeignCurrency = investmentCurrency !== "INR";
  useEffect(() => {
    if (!isForeignCurrency) {
      setExchangeRate("");
      return;
    }
    let cancelled = false;
    setFetchingRate(true);
    fetch(`/api/market/rate?from=${investmentCurrency}&to=INR&date=${date}`)
      .then((r) => r.json())
      .then((data: { rate?: number }) => {
        if (cancelled) return;
        if (data.rate && data.rate > 0) setExchangeRate(data.rate.toFixed(2));
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setFetchingRate(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isForeignCurrency, investmentCurrency, date]);

  // When the user picks an existing holding, sync currency from it.
  useEffect(() => {
    if (!selected) return;
    setInvestmentCurrency((selected.currency as "INR" | "USD") === "USD" ? "USD" : "INR");
  }, [selected]);

  // Sync the category chip to the active kind on first load.
  useEffect(() => {
    if (categoryId) return;
    const match = categories.find(
      (c) => categoryNameToKind(c.name) === activeKind,
    );
    if (match) setCategoryId(match.id);
  }, [categories, activeKind, categoryId]);

  // Auto-compute amount when qty + price are entered. For foreign-currency
  // (e.g. USD stock), multiply by the exchange rate so `amount` stays in INR.
  useEffect(() => {
    const q = parseFloat(quantity);
    const p = parseFloat(price);
    const r = isForeignCurrency ? parseFloat(exchangeRate) : 1;
    if (q > 0 && p > 0 && r > 0) {
      setAmount(String(Number((q * p * r).toFixed(2))));
    }
  }, [quantity, price, isForeignCurrency, exchangeRate]);

  function applyLivePrice() {
    if (livePrice) setPrice(livePrice.price.toFixed(2));
  }

  async function submit() {
    setError(null);
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      setError("Enter an amount");
      return;
    }
    if (!accountId) {
      setError("Pick an account");
      return;
    }
    if (creatingNew) {
      if (!newName.trim()) {
        setError("Enter a name for the new holding");
        return;
      }
      if (newKind === "STOCK" && !newSymbol.trim()) {
        setError("Enter a symbol for the new stock holding");
        return;
      }
    } else if (!investmentId) {
      setError("Pick a holding");
      return;
    }
    setSubmitting(true);
    try {
      if (creatingNew) {
        // Create the holding — the API also posts the initial BUY txn.
        const res = await fetch("/api/investments", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: newKind,
            name: newName.trim(),
            symbol: newKind === "STOCK" ? newSymbol.trim().toUpperCase() : undefined,
            exchange: newKind === "STOCK" ? newExchange || undefined : undefined,
            institution:
              newKind === "FD" ||
              newKind === "RD" ||
              newKind === "MUTUAL_FUND" ||
              newKind === "SIP"
                ? newInstitution.trim() || undefined
                : undefined,
            interestRate:
              (newKind === "FD" || newKind === "RD") && newInterestRate
                ? Number(newInterestRate)
                : undefined,
            maturityAt:
              (newKind === "FD" || newKind === "RD") && newMaturityAt
                ? newMaturityAt
                : undefined,
            policyNumber:
              newKind === "INSURANCE" && newPolicyNumber.trim()
                ? newPolicyNumber.trim()
                : undefined,
            policyType: newKind === "INSURANCE" ? newPolicyType : undefined,
            nominee:
              newKind === "INSURANCE" && newNominee.trim()
                ? newNominee.trim()
                : undefined,
            premiumAmount:
              newKind === "INSURANCE" && newPremium ? Number(newPremium) : undefined,
            metadata:
              newKind === "GOLD"
                ? (() => {
                    const w = parseFloat(quantity) || 0;
                    const r = parseFloat(price) || 0;
                    const goldValue = w * r;
                    const wastageAmt = resolveAmount(
                      newGoldWastage,
                      newGoldWastageMode,
                      goldValue,
                    );
                    const makingAmt = resolveAmount(
                      newGoldMaking,
                      newGoldMakingMode,
                      goldValue,
                    );
                    const gstAmt = resolveAmount(
                      newGoldGst,
                      newGoldGstMode,
                      goldValue + wastageAmt + makingAmt,
                    );
                    return {
                      goldType: newGoldType,
                      purity: newGoldPurity,
                      wastage: wastageAmt || null,
                      wastageInput: newGoldWastage || null,
                      wastageMode: newGoldWastageMode,
                      making: makingAmt || null,
                      makingInput: newGoldMaking || null,
                      makingMode: newGoldMakingMode,
                      gst: gstAmt || null,
                      gstInput: newGoldGst || null,
                      gstMode: newGoldGstMode,
                    };
                  })()
                : undefined,
            currency: investmentCurrency,
            amount: amt,
            quantity: quantity ? Number(quantity) : undefined,
            purchasePrice: price ? Number(price) : undefined,
            startedAt: date,
            accountId,
            isExisting: false,
          }),
        });
        const body = await res.json();
        if (!res.ok) {
          setError(body.error ?? "Failed");
          return;
        }
        toast.success("Holding created and purchase recorded");
        await mutateBalances();
        onClose();
        return;
      }
      const payload: Record<string, unknown> = {
        type: "INVESTMENT",
        amount: amt,
        description:
          description.trim() ||
          `${action === "BUY" ? "Buy" : "Sell"} · ${selected?.name ?? "Investment"}`,
        date,
        accountId,
        categoryId: categoryId || null,
        investmentId,
        investmentAction: action,
        investmentQty: quantity ? Number(quantity) : null,
        investmentPrice: price ? Number(price) : null,
        exchangeRate:
          isForeignCurrency && exchangeRate ? Number(exchangeRate) : null,
      };
      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Failed");
        return;
      }
      toast.success(action === "BUY" ? "Investment purchase recorded" : "Investment sale recorded");
      await mutateBalances();
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  // Pick action labels per active kind so the buttons read naturally for FDs
  // / insurance (e.g. "Premium" instead of "Buy", "Mature" instead of "Sell").
  const buyLabel =
    activeKind === "FD" || activeKind === "RD"
      ? "Open"
      : activeKind === "INSURANCE"
        ? "Pay premium"
        : activeKind === "SIP"
          ? "SIP installment"
          : activeKind === "GOLD"
            ? "Buy gold"
            : "Buy";
  const sellLabel =
    activeKind === "FD" || activeKind === "RD"
      ? "Mature / redeem"
      : activeKind === "INSURANCE"
        ? "Claim / surrender"
        : activeKind === "GOLD"
          ? "Sell gold"
          : "Sell";

  return (
    <div className="space-y-3">
      {categories.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {categories.map((cat) => {
            const k = categoryNameToKind(cat.name);
            const active = categoryId === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => {
                  setCategoryId(cat.id);
                  // Picking a chip drives the kind. If the user is in
                  // create-new mode we update newKind, otherwise we clear
                  // the selection so the picker filters down.
                  setNewKind(k as typeof newKind);
                  if (!creatingNew) setInvestmentId("");
                }}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wider transition-colors",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground hover:border-foreground/40",
                )}
              >
                {cat.name}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex gap-2">
        <Button
          type="button"
          variant={action === "BUY" ? "default" : "outline"}
          onClick={() => setAction("BUY")}
          className="gap-1.5"
        >
          <ArrowUpRight className="h-4 w-4" /> {buyLabel}
        </Button>
        <Button
          type="button"
          variant={action === "SELL" ? "default" : "outline"}
          onClick={() => {
            setAction("SELL");
            setCreatingNew(false);
          }}
          className="gap-1.5"
        >
          <ArrowDownLeft className="h-4 w-4" /> {sellLabel}
        </Button>
      </div>

      {creatingNew ? (
        <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              New holding
            </span>
            <button
              type="button"
              onClick={() => {
                setCreatingNew(false);
                setNewName("");
                setNewSymbol("");
                setNewExchange("");
                setNewInstitution("");
                setNewInterestRate("");
                setNewMaturityAt("");
                setNewPolicyNumber("");
                setNewPremium("");
              }}
              className="text-xs font-medium text-primary hover:underline"
            >
              ← Use existing
            </button>
          </div>
          <label className="block">
            <span className="text-xs font-medium">Kind</span>
            <div className="mt-1">
              <NativeSelect
                value={newKind}
                onChange={(v) => setNewKind(v as typeof newKind)}
                options={[
                  { value: "STOCK", label: "Stock" },
                  { value: "MUTUAL_FUND", label: "Mutual fund" },
                  { value: "FD", label: "Fixed deposit" },
                  { value: "RD", label: "Recurring deposit" },
                  { value: "SIP", label: "SIP" },
                  { value: "INSURANCE", label: "Insurance" },
                  { value: "GOLD", label: "Gold" },
                  { value: "OTHER", label: "Other" },
                ]}
              />
            </div>
          </label>

          {newKind === "STOCK" ? (
            <label className="block">
              <span className="text-xs font-medium">Search stock</span>
              <div className="mt-1">
                <SymbolSearch
                  value={newSymbol}
                  name={newName}
                  showHint={false}
                  onChange={(sym, n, ex) => {
                    setNewSymbol(sym);
                    setNewName(n);
                    setNewExchange(ex);
                  }}
                />
              </div>
            </label>
          ) : (
            <label className="block">
              <span className="text-xs font-medium">Name</span>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={
                  newKind === "FD"
                    ? "e.g. SBI 1Y FD"
                    : newKind === "RD"
                      ? "e.g. HDFC 12-mo RD"
                      : newKind === "MUTUAL_FUND"
                        ? "e.g. HDFC Top 100"
                        : newKind === "SIP"
                          ? "e.g. Axis Bluechip SIP"
                          : newKind === "INSURANCE"
                            ? "e.g. LIC Jeevan Anand"
                            : newKind === "GOLD"
                              ? "e.g. 24K Gold coin / Sovereign Gold Bond"
                              : "Holding name"
                }
                autoFocus
              />
            </label>
          )}

          {(newKind === "FD" ||
            newKind === "RD" ||
            newKind === "MUTUAL_FUND" ||
            newKind === "SIP") && (
            <label className="block">
              <span className="text-xs font-medium">
                {newKind === "FD" || newKind === "RD" ? "Bank / institution" : "Fund house"}
              </span>
              <BankPicker value={newInstitution} onChange={setNewInstitution} />
            </label>
          )}

          {(newKind === "FD" || newKind === "RD") && (
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-medium">Interest rate (%)</span>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={newInterestRate}
                  onChange={(e) => setNewInterestRate(e.target.value)}
                  placeholder="e.g. 7.25"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium">Maturity date</span>
                <DateInput
                  value={newMaturityAt}
                  onChange={(e) => setNewMaturityAt(e.target.value)}
                />
              </label>
            </div>
          )}

          {newKind === "INSURANCE" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-medium">Policy type</span>
                  <div className="mt-1">
                    <NativeSelect
                      value={newPolicyType}
                      onChange={setNewPolicyType}
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
                    value={newNominee}
                    onChange={(e) => setNewNominee(e.target.value)}
                    placeholder="Optional"
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-medium">Policy number</span>
                  <Input
                    value={newPolicyNumber}
                    onChange={(e) => setNewPolicyNumber(e.target.value)}
                    placeholder="Optional"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium">Premium (₹)</span>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={newPremium}
                    onChange={(e) => setNewPremium(e.target.value)}
                    placeholder="0"
                  />
                </label>
              </div>
            </>
          )}

          {newKind === "GOLD" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-medium">Type</span>
                  <div className="mt-1">
                    <NativeSelect
                      value={newGoldType}
                      onChange={(v) => setNewGoldType(v as typeof newGoldType)}
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
                      value={newGoldPurity}
                      onChange={setNewGoldPurity}
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
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-medium">Weight (g)</span>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    placeholder="0"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium">Rate per gram (₹)</span>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="0"
                  />
                </label>
              </div>
              {(() => {
                const w = parseFloat(quantity);
                const r = parseFloat(price);
                const goldValue = w > 0 && r > 0 ? w * r : 0;
                const ws = resolveAmount(newGoldWastage, newGoldWastageMode, goldValue);
                const mk = resolveAmount(newGoldMaking, newGoldMakingMode, goldValue);
                const gstBase = goldValue + ws + mk;
                const gst = resolveAmount(newGoldGst, newGoldGstMode, gstBase);
                return (
                  <>
                    {newGoldType === "ORNAMENTS" ? (
                      <div className="grid grid-cols-3 gap-3">
                        <label className="block">
                          <span className="text-xs font-medium">Wastage</span>
                          <PercentOrRupeeInput
                            value={newGoldWastage}
                            onValueChange={setNewGoldWastage}
                            mode={newGoldWastageMode}
                            onModeChange={setNewGoldWastageMode}
                            baseAmount={goldValue}
                          />
                        </label>
                        <label className="block">
                          <span className="text-xs font-medium">Making</span>
                          <PercentOrRupeeInput
                            value={newGoldMaking}
                            onValueChange={setNewGoldMaking}
                            mode={newGoldMakingMode}
                            onModeChange={setNewGoldMakingMode}
                            baseAmount={goldValue}
                          />
                        </label>
                        <label className="block">
                          <span className="text-xs font-medium">GST</span>
                          <PercentOrRupeeInput
                            value={newGoldGst}
                            onValueChange={setNewGoldGst}
                            mode={newGoldGstMode}
                            onModeChange={setNewGoldGstMode}
                            baseAmount={gstBase}
                          />
                        </label>
                      </div>
                    ) : (
                      <label className="block">
                        <span className="text-xs font-medium">GST</span>
                        <PercentOrRupeeInput
                          value={newGoldGst}
                          onValueChange={setNewGoldGst}
                          mode={newGoldGstMode}
                          onModeChange={setNewGoldGstMode}
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
                        showWastage={newGoldType === "ORNAMENTS"}
                        showMaking={newGoldType === "ORNAMENTS"}
                        onUseTotal={(total) => setAmount(String(Math.round(total)))}
                      />
                    )}
                  </>
                );
              })()}
            </>
          )}
        </div>
      ) : (
        <label className="block">
          <span className="text-xs font-medium">Holding</span>
          <div className="mt-1">
            <HoldingPicker
              value={investmentId}
              onChange={setInvestmentId}
              holdings={filteredHoldings.map((i) => ({
                id: i.id,
                kind: i.kind,
                name: i.name,
                symbol: i.symbol,
                exchange: i.exchange,
                quantity: i.quantity,
                amount: i.amount,
              }))}
              onAddNew={action === "BUY" ? () => setCreatingNew(true) : undefined}
            />
          </div>
          {filteredHoldings.length === 0 && action === "BUY" && (
            <p className="mt-1 text-xs text-muted-foreground">
              No {activeKind.toLowerCase().replace("_", " ")} holdings yet — use{" "}
              <button
                type="button"
                onClick={() => setCreatingNew(true)}
                className="font-medium text-primary hover:underline"
              >
                Add new holding
              </button>{" "}
              to create one.
            </p>
          )}
          {filteredHoldings.length === 0 && action === "SELL" && (
            <p className="mt-1 text-xs text-muted-foreground">
              No active {activeKind.toLowerCase().replace("_", " ")} holdings to sell.
            </p>
          )}
        </label>
      )}

      {/* Insurance: when an existing INSURANCE holding with a known premium
          is being paid, show the premium-breakdown widget INSTEAD of the
          generic Amount/Qty/Price fields. */}
      {action === "BUY" &&
      !creatingNew &&
      selected?.kind === "INSURANCE" &&
      selected.premiumAmount &&
      Number(selected.premiumAmount) > 0 ? (
        <>
          <InsurancePremiumBreakdown
            policyName={selected.name}
            institution={selected.institution ?? null}
            premiumAmount={Number(selected.premiumAmount)}
            nextDueDate={selected.nextDueDate ?? null}
            frequency={selected.premiumFrequency ?? null}
            onTotalChange={(total) => setAmount(String(total))}
            onNotesChange={(n) => setDescription(n)}
          />
          <label className="block">
            <span className="text-xs font-medium">Date</span>
            <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium">
                Amount {isForeignCurrency ? "(₹ equivalent)" : "(₹)"}
              </span>
              <AmountInput value={amount} onChange={setAmount} placeholder="0" />
            </label>
            <label className="block">
              <span className="text-xs font-medium">Date</span>
              <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
          </div>

          {isQtyBased && (
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-medium">
                  {activeKind === "STOCK"
                    ? "Shares"
                    : activeKind === "MUTUAL_FUND"
                      ? "Units"
                      : "Quantity"}
                </span>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="0"
                  min="0"
                  step="any"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium">
                  {activeKind === "MUTUAL_FUND" ? "NAV" : "Price per unit"}{" "}
                  {isForeignCurrency ? "($)" : "(₹)"}
                </span>
                <div className="relative">
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder={fetchingPrice ? "Fetching live price…" : "Optional"}
                    min="0"
                    step="any"
                    className="pr-8"
                  />
                  {fetchingPrice && (
                    <RefreshCw className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  )}
                </div>
              </label>
            </div>
          )}

          {isStock && livePrice && activeSymbol && (
            <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2 text-xs">
              <span>
                Live price for{" "}
                <span className="font-mono font-semibold">{activeSymbol}</span>:{" "}
                {livePrice.currency === "USD" ? "$" : "₹"}
                {livePrice.price.toLocaleString("en-IN", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </span>
              <Button type="button" size="xs" variant="outline" onClick={applyLivePrice}>
                Use live price
              </Button>
            </div>
          )}

          {isForeignCurrency && (
            <div className="rounded-md border border-amber-200 bg-amber-50/50 dark:border-amber-900/40 dark:bg-amber-950/20 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">
                  Exchange rate ({investmentCurrency} → INR)
                </span>
                {fetchingRate && (
                  <span className="text-[10px] text-amber-700 dark:text-amber-300 animate-pulse">
                    Fetching rate…
                  </span>
                )}
              </div>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground">
                  1 {investmentCurrency} =
                </span>
                <Input
                  type="number"
                  step="0.0001"
                  min="0.0001"
                  value={exchangeRate}
                  onChange={(e) => setExchangeRate(e.target.value)}
                  placeholder="0.0000"
                  className="pl-20"
                />
              </div>
              {(() => {
                const q = parseFloat(quantity);
                const p = parseFloat(price);
                const r = parseFloat(exchangeRate);
                if (q > 0 && p > 0 && r > 0) {
                  const inr = q * p * r;
                  return (
                    <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
                      INR equivalent:{" "}
                      <span className="tabular-nums font-semibold">
                        ₹{inr.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                      </span>
                    </p>
                  );
                }
                return null;
              })()}
            </div>
          )}
        </>
      )}

      <label className="block">
        <span className="text-xs font-medium">
          {action === "BUY" ? "Pay from" : "Deposit to"}
        </span>
        <div className="mt-1">
          <NativeSelect
            value={accountId}
            onChange={setAccountId}
            options={accounts.map((a) =>
              buildAccountOption(a, action === "BUY" ? Number(amount) || 0 : 0),
            )}
          />
        </div>
      </label>

      <label className="block">
        <span className="text-xs font-medium">Description</span>
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional"
          maxLength={200}
        />
      </label>

      <p className="text-xs text-muted-foreground">
        {action === "BUY"
          ? "Adds to the holding's invested amount and quantity."
          : "Reduces the holding's invested amount and quantity (clamped at 0)."}
      </p>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={submitting}>
          {submitting ? "Saving…" : action === "BUY" ? "Record purchase" : "Record sale"}
        </Button>
      </DialogFooter>
    </div>
  );
}
