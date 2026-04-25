"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight, LineChart, HandCoins } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { AmountInput } from "@/components/ui/amount-input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn, formatINR } from "@/lib/utils";
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

  const accounts = accountsData?.accounts ?? [];
  const cards = (cardsData?.cards ?? []).filter((c) => c.kind === "CREDIT" && c.accountId);
  const categories = categoriesData?.categories ?? [];
  const family = familyData?.members ?? [];
  const cropBatches = cropBatchesData?.batches ?? [];
  const livestockBatches = livestockBatchesData?.batches ?? [];

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
  onClose,
}: {
  type: "INCOME" | "EXPENSE";
  accounts: Account[];
  cards: Card[];
  categories: Category[];
  family: FamilyMember[];
  cropBatches: CropBatch[];
  livestockBatches: LivestockBatch[];
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

  const sources = useMemo(() => {
    const items: { value: string; label: string; sub: string }[] = [];
    for (const a of accounts) {
      if (a.kind === "CARD") continue; // companion cards are surfaced via Cards
      items.push({
        value: `account:${a.id}`,
        label: a.name,
        sub: `${a.kind} · ${formatINR(a.balance)}`,
      });
    }
    if (type === "EXPENSE") {
      for (const c of cards) {
        items.push({
          value: `card:${c.id}`,
          label: c.name,
          sub: `Credit · ${c.availableLimit != null ? formatINR(c.availableLimit) : "—"} avail`,
        });
      }
    }
    return items;
  }, [accounts, cards, type]);

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
    setSubmitting(true);
    try {
      const [kind, sid] = paymentSource.split(":");
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

      <label className="block">
        <span className="text-xs font-medium">{type === "INCOME" ? "To account" : "Pay from"}</span>
        <select
          className="w-full rounded border border-input bg-background px-2 py-2 text-sm mt-1"
          value={paymentSource}
          onChange={(e) => setPaymentSource(e.target.value)}
        >
          <option value="">— pick —</option>
          {sources.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label} ({s.sub})
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="text-xs font-medium">Category</span>
        <select
          className="w-full rounded border border-input bg-background px-2 py-2 text-sm mt-1"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
        >
          <option value="">— optional —</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.group ? `${c.group} · ${c.name}` : c.name}
            </option>
          ))}
        </select>
      </label>

      {(cropBatches.length > 0 || livestockBatches.length > 0) && (
        <label className="block">
          <span className="text-xs font-medium">Tag to farm batch (optional)</span>
          <select
            className="w-full rounded border border-input bg-background px-2 py-2 text-sm mt-1"
            value={tagSource}
            onChange={(e) => setTagSource(e.target.value)}
          >
            <option value="">— none —</option>
            {cropBatches.length > 0 && (
              <optgroup label="Crops">
                {cropBatches.map((b) => (
                  <option key={b.id} value={`crop:${b.id}`}>
                    {b.crop.name} · {b.name} ({b.status})
                  </option>
                ))}
              </optgroup>
            )}
            {livestockBatches.length > 0 && (
              <optgroup label="Livestock">
                {livestockBatches.map((b) => (
                  <option key={b.id} value={`livestock:${b.id}`}>
                    {b.livestock.name} · {b.name} ({b.currentCount} head)
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <p className="mt-1 text-xs text-muted-foreground">
            Tags this transaction to a crop or livestock batch for per-batch P&amp;L. Leases land
            in M11.
          </p>
        </label>
      )}

      {type === "EXPENSE" && (
        <details className="rounded-md border bg-card">
          <summary className="cursor-pointer select-none px-4 py-2 text-sm">
            Spent for a family member?
          </summary>
          <div className="px-4 pb-4 pt-2 space-y-2">
            <select
              className="w-full rounded border border-input bg-background px-2 py-2 text-sm"
              value={beneficiaryMemberId}
              onChange={(e) => setBeneficiaryMemberId(e.target.value)}
            >
              <option value="">— pick member —</option>
              {family.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
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
        <Button onClick={submit} disabled={submitting}>
          {submitting ? "Saving…" : `Save ${type === "INCOME" ? "income" : "expense"}`}
        </Button>
      </DialogFooter>
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

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="text-xs font-medium">From</span>
        <select
          className="w-full rounded border border-input bg-background px-2 py-2 text-sm mt-1"
          value={fromId}
          onChange={(e) => setFromId(e.target.value)}
        >
          <option value="">— pick —</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.kind})
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-xs font-medium">To</span>
        <select
          className="w-full rounded border border-input bg-background px-2 py-2 text-sm mt-1"
          value={toId}
          onChange={(e) => setToId(e.target.value)}
        >
          <option value="">— pick —</option>
          {accounts
            .filter((a) => a.id !== fromId)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.kind})
              </option>
            ))}
        </select>
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
        <select
          className="w-full rounded border border-input bg-background px-2 py-2 text-sm mt-1"
          value={memberId}
          onChange={(e) => setMemberId(e.target.value)}
        >
          <option value="">— pick —</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
              {m.balance !== 0 ? ` (${m.balance > 0 ? "owes" : "advanced"} ₹${Math.abs(m.balance).toLocaleString("en-IN")})` : ""}
            </option>
          ))}
          <option value="NEW">+ Add new person</option>
        </select>
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
        <select
          className="w-full rounded border border-input bg-background px-2 py-2 text-sm mt-1"
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
        >
          <option value="">— pick —</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.kind})
            </option>
          ))}
        </select>
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

  const selected = investments.find((i) => i.id === investmentId) ?? null;

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
        <select
          className="w-full rounded border border-input bg-background px-2 py-2 text-sm mt-1"
          value={investmentId}
          onChange={(e) => setInvestmentId(e.target.value)}
        >
          <option value="">— pick —</option>
          {investments.map((i) => (
            <option key={i.id} value={i.id}>
              {i.kind} · {i.name}
              {i.symbol ? ` (${i.symbol})` : ""}
              {i.quantity != null ? ` · ${i.quantity} units` : ""}
            </option>
          ))}
        </select>
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
            placeholder="Optional"
            min="0"
            step="any"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium">Price per unit (₹)</span>
          <Input
            type="number"
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="Optional"
            min="0"
            step="any"
          />
        </label>
      </div>

      <label className="block">
        <span className="text-xs font-medium">
          {action === "BUY" ? "Pay from" : "Deposit to"}
        </span>
        <select
          className="w-full rounded border border-input bg-background px-2 py-2 text-sm mt-1"
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
        >
          <option value="">— pick —</option>
          {accounts
            .filter((a) => a.kind !== "CARD")
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.kind} · {formatINR(a.balance)})
              </option>
            ))}
        </select>
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
