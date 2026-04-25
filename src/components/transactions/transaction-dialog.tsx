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

  const accounts = accountsData?.accounts ?? [];
  const cards = (cardsData?.cards ?? []).filter((c) => c.kind === "CREDIT" && c.accountId);
  const categories = categoriesData?.categories ?? [];
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
        <InvestmentForm accounts={accounts} onClose={onClose} />
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
              <div className="flex gap-2 flex-wrap">
                {(
                  [
                    { v: "NONE", l: "Shared cost" },
                    { v: "RECOVERABLE", l: "Recover later" },
                    { v: "GIFT", l: "Gift" },
                  ] as { v: ChargeFlag; l: string }[]
                ).map((opt) => (
                  <Button
                    key={opt.v}
                    type="button"
                    size="sm"
                    variant={chargeFlag === opt.v ? "default" : "outline"}
                    onClick={() => setChargeFlag(opt.v)}
                  >
                    {opt.l}
                  </Button>
                ))}
                <p className="w-full text-xs text-muted-foreground">
                  {chargeFlag === "RECOVERABLE"
                    ? "Adds to that member's owed balance — settle later in the Member Ledger."
                    : chargeFlag === "GIFT"
                      ? "Tagged as a gift — stays in expenses, no balance change."
                      : "Just tagged for reporting; no balance impact."}
                </p>
              </div>
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
};

function InvestmentForm({
  accounts,
  onClose,
}: {
  accounts: Account[];
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

  const selected = investments.find((i) => i.id === investmentId) ?? null;
  const isStock = selected?.kind === "STOCK" && !!selected?.symbol;

  // When a stock holding is selected, fetch its live price.
  useEffect(() => {
    setLivePrice(null);
    if (!isStock || !selected?.symbol) return;
    let cancelled = false;
    setFetchingPrice(true);
    fetch(`/api/market/quote?symbols=${encodeURIComponent(selected.symbol)}`)
      .then((r) => r.json())
      .then((data: StockQuote[]) => {
        if (cancelled) return;
        const q = data?.[0];
        if (q && q.price > 0) setLivePrice({ price: q.price, currency: q.currency || "INR" });
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setFetchingPrice(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isStock, selected?.symbol]);

  // Auto-compute amount when qty + price are entered.
  useEffect(() => {
    const q = parseFloat(quantity);
    const p = parseFloat(price);
    if (q > 0 && p > 0) {
      setAmount(String(Number((q * p).toFixed(2))));
    }
  }, [quantity, price]);

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
    if (!investmentId) {
      setError("Pick a holding");
      return;
    }
    if (!accountId) {
      setError("Pick an account");
      return;
    }
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        type: "INVESTMENT",
        amount: amt,
        description:
          description.trim() ||
          `${action === "BUY" ? "Buy" : "Sell"} · ${selected?.name ?? "Investment"}`,
        date,
        accountId,
        investmentId,
        investmentAction: action,
        investmentQty: quantity ? Number(quantity) : null,
        investmentPrice: price ? Number(price) : null,
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

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Button
          type="button"
          variant={action === "BUY" ? "default" : "outline"}
          onClick={() => setAction("BUY")}
          className="gap-1.5"
        >
          <ArrowUpRight className="h-4 w-4" /> Buy
        </Button>
        <Button
          type="button"
          variant={action === "SELL" ? "default" : "outline"}
          onClick={() => setAction("SELL")}
          className="gap-1.5"
        >
          <ArrowDownLeft className="h-4 w-4" /> Sell
        </Button>
      </div>

      <label className="block">
        <span className="text-xs font-medium">Holding</span>
        <div className="mt-1">
          <NativeSelect
            value={investmentId}
            onChange={setInvestmentId}
            options={investments.map((i) => ({
              value: i.id,
              label:
                `${i.kind} · ${i.name}` +
                (i.symbol ? ` (${i.symbol})` : "") +
                (i.quantity != null ? ` · ${i.quantity} units` : ""),
            }))}
          />
        </div>
        {investments.length === 0 && (
          <p className="mt-1 text-xs text-muted-foreground">
            No active holdings yet. Create one in Investments first.
          </p>
        )}
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-medium">Amount (₹)</span>
          <AmountInput value={amount} onChange={setAmount} placeholder="0" />
        </label>
        <label className="block">
          <span className="text-xs font-medium">Date</span>
          <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-medium">Quantity</span>
          <Input
            type="number"
            inputMode="decimal"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder={isStock ? "Shares" : "Optional"}
            min="0"
            step="any"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium">
            Price per unit {selected?.currency === "USD" ? "($)" : "(₹)"}
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

      {isStock && livePrice && (
        <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2 text-xs">
          <span>
            Live price for <span className="font-mono font-semibold">{selected?.symbol}</span>:{" "}
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

      <label className="block">
        <span className="text-xs font-medium">
          {action === "BUY" ? "Pay from" : "Deposit to"}
        </span>
        <div className="mt-1">
          <NativeSelect
            value={accountId}
            onChange={setAccountId}
            options={accounts
              .filter((a) => a.kind !== "CARD")
              .map((a) => {
                const amtNum = parseFloat(amount) || 0;
                const insufficient = action === "BUY" && amtNum > 0 && amtNum > a.balance;
                return {
                  value: a.id,
                  label: a.name,
                  hint: `${a.kind} · ${formatINR(a.balance)}`,
                  disabled: insufficient,
                };
              })}
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
