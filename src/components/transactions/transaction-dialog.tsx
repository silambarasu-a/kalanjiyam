"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import useSWR, { mutate as globalMutate } from "swr";
import { toast } from "sonner";
import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight, LineChart, HandCoins, RefreshCw, RotateCcw } from "lucide-react";
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
import { InsurerPicker } from "@/components/ui/insurer-picker";
import type { InsurerCategory } from "@/lib/insurers";
import {
  EMPTY_INSURANCE_EXTRAS,
  buildInsuranceExtraPayload,
  incompleteMemberRows,
  InsurancePolicyExtrasFields,
  submitPolicyMembers,
  type InsurancePolicyExtras,
} from "@/components/insurance/policy-extras-fields";
import { CategoryCombobox } from "@/components/categories/category-combobox";
import { CategoryQuickCreateDialog } from "@/components/categories/category-quick-create-dialog";
import {
  ReceiptStager,
  uploadReceiptsToAttachment,
} from "@/components/transactions/receipt-stager";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn, formatINR, groupAccountOptions, formatAccountLabel } from "@/lib/utils";
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
  last4: string | null;
};
type Category = {
  id: string;
  name: string;
  group: string | null;
  types: string[];
  parentCategoryId: string | null;
};
type Contact = { id: string; name: string };
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

// uploadReceiptsToAttachment was extracted to
// @/components/transactions/receipt-stager so the helper can be shared
// with InvestmentForm / TransferForm / LoanEmiForm without duplication.

/**
 * Map a policy type to the insurer categories that actually sell that
 * line of business. Returns undefined for OTHER (no filter) so the
 * picker shows the full list.
 */
function insurerCategoriesForPolicyType(
  policyType: string,
): InsurerCategory[] | undefined {
  switch (policyType) {
    case "LIFE":
    case "TERM":
    case "ENDOWMENT":
    case "ULIP":
      return ["Life"];
    case "HEALTH":
      return ["Health"];
    case "VEHICLE":
    case "HOME":
    case "TRAVEL":
      return ["General", "Standalone digital"];
    default:
      return undefined;
  }
}

const TABS: { value: TransactionDefault; label: string; icon: React.ElementType; disabled?: boolean }[] = [
  { value: "INCOME", label: "Income", icon: ArrowDownLeft },
  { value: "EXPENSE", label: "Expense", icon: ArrowUpRight },
  { value: "REFUND", label: "Refund", icon: RotateCcw },
  { value: "TRANSFER", label: "Transfer", icon: ArrowLeftRight },
  { value: "LOAN", label: "Loan", icon: HandCoins },
  { value: "INVESTMENT", label: "Invest", icon: LineChart },
];

export function TransactionDialog() {
  const { open, defaultType, defaultCreatingNew, editingInvestmentId, closeDialog } =
    useTransactionDialog();
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
    <DialogBody
      key={open ? `open-${editingInvestmentId ?? ""}` : "closed"}
      defaultType={defaultType}
      defaultCreatingNew={defaultCreatingNew}
      editingInvestmentId={editingInvestmentId}
      onClose={closeDialog}
    />
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={(o) => !o && closeDialog()}>
        <SheetContent side="bottom">
          <SheetHeader>
            <SheetTitle>{editingInvestmentId ? "Edit investment" : "New transaction"}</SheetTitle>
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
          <DialogTitle>{editingInvestmentId ? "Edit investment" : "New transaction"}</DialogTitle>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}

function DialogBody({
  defaultType,
  defaultCreatingNew,
  editingInvestmentId,
  onClose,
}: {
  defaultType: TransactionDefault;
  defaultCreatingNew: boolean;
  editingInvestmentId: string | null;
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
  const { data: contactsData } = useSWR<{ members: Contact[] }>("/api/contacts", fetcher);
  const { data: cropBatchesData } = useSWR<{ batches: CropBatch[] }>(
    "/api/crop-batches?active=true",
    fetcher
  );
  const { data: livestockBatchesData } = useSWR<{ batches: LivestockBatch[] }>(
    "/api/livestock-batches?active=true",
    fetcher
  );
  const { data: eventsData } = useSWR<{
    events: {
      id: string;
      name: string;
      kind: string;
      startedAt: string;
      endedAt: string | null;
      active: boolean;
    }[];
  }>("/api/events?status=active", fetcher);
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
  const contacts = contactsData?.members ?? [];
  const cropBatches = cropBatchesData?.batches ?? [];
  const livestockBatches = livestockBatchesData?.batches ?? [];
  const events = eventsData?.events ?? [];
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
      ) : type === "LOAN" ? (
        <LoanEmiForm accounts={accounts} onClose={onClose} />
      ) : type === "INVESTMENT" ? (
        <InvestmentForm
          accounts={accounts}
          cards={cards}
          categories={investmentCategories}
          defaultCreatingNew={defaultCreatingNew}
          editingInvestmentId={editingInvestmentId}
          onClose={onClose}
          onSwitchToExpense={() => setType("EXPENSE")}
        />
      ) : type === "REFUND" ? (
        <RefundForm cards={cards} onClose={onClose} />
      ) : (
        <IncomeExpenseForm
          type={type}
          accounts={accounts}
          cards={cards}
          categories={categories}
          contacts={contacts}
          cropBatches={cropBatches}
          livestockBatches={livestockBatches}
          events={events}
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
  contacts,
  cropBatches,
  livestockBatches,
  events,
  workers,
  onClose,
}: {
  type: "INCOME" | "EXPENSE";
  accounts: Account[];
  cards: Card[];
  categories: Category[];
  contacts: Contact[];
  cropBatches: CropBatch[];
  livestockBatches: LivestockBatch[];
  events: {
    id: string;
    name: string;
    kind: string;
    startedAt: string;
    endedAt: string | null;
    active: boolean;
  }[];
  workers: Worker[];
  onClose: () => void;
}) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(today);
  const [categoryId, setCategoryId] = useState("");
  // Inline "+ New category" creation triggered from the CategoryCombobox.
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [quickCreateName, setQuickCreateName] = useState("");
  const [paymentSource, setPaymentSource] = useState<string>(""); // "account:<id>" or "card:<id>"
  const [beneficiaryContactId, setBeneficiaryMemberId] = useState("");
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
  const VEHICLE_CATEGORIES = new Set(["vehicle purchase", "vehicle service", "fuel"]);
  const isVehicleMode =
    type === "EXPENSE" &&
    !!selectedCategory?.name &&
    VEHICLE_CATEGORIES.has(selectedCategory.name.toLowerCase());
  // Sub-mode: when the Vehicle category is specifically "fuel" we
  // surface quantity + odometer inputs so mileage can be tracked.
  const isFuelMode =
    type === "EXPENSE" && selectedCategory?.name?.toLowerCase() === "fuel";
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const { data: vehiclesData } = useSWR<{
    vehicles: {
      id: string;
      name: string;
      kind: string;
      registrationNo: string | null;
      fuelType:
        | "PETROL"
        | "DIESEL"
        | "CNG"
        | "LPG"
        | "ELECTRIC"
        | "HYBRID"
        | "OTHER"
        | null;
    }[];
  }>(isVehicleMode ? "/api/vehicles" : null, fetcher);
  const vehicles = vehiclesData?.vehicles ?? [];

  // "Also log this as a document renewal" — when ticked, the same submit
  // creates a VehicleDocument tied to the picked vehicle so the system
  // schedules the next renewal reminder. Receipt PDF can be attached
  // afterwards from either the transaction edit dialog or the doc row.
  // Staged receipt files — uploaded post-save to the most useful owner
  // (VehicleDocument > Event > Transaction). Held client-side as
  // File objects until we have the row id to anchor the Attachment.
  const [receiptFiles, setReceiptFiles] = useState<File[]>([]);
  // Per-kind cap is enforced server-side; we duplicate the same table
  // here for friendlier inline validation. Keep in sync with
  // src/lib/attachments.ts ATTACHMENT_POLICY[*].maxMB.
  const ATTACHMENT_MAX_MB: Record<
    "VEHICLE_DOCUMENT" | "EVENT_DOCUMENT" | "TRANSACTION_RECEIPT",
    number
  > = {
    VEHICLE_DOCUMENT: 20,
    EVENT_DOCUMENT: 25,
    TRANSACTION_RECEIPT: 50,
  };
  const [createVehicleDoc, setCreateVehicleDoc] = useState(false);
  const [vehicleDocKind, setVehicleDocKind] = useState<
    "RC" | "FC" | "PUC" | "ROAD_TAX" | "INSURANCE_COPY" | "OTHER"
  >("PUC");
  const [vehicleDocExpiryAt, setVehicleDocExpiryAt] = useState("");
  const [vehicleDocNumber, setVehicleDocNumber] = useState("");

  // Fuel-fill metadata — surfaced when the Fuel category is selected
  // AND a vehicle is picked. Quantity unit is inferred from the
  // vehicle's fuelType ("L" for petrol/diesel/CNG/LPG/hybrid, "kWh"
  // for EV) so the user only types a number; odometer is the km
  // reading at the fill, used for mileage on /vehicles/[id].
  const [fuelQuantity, setFuelQuantity] = useState("");
  const [fuelOdometer, setFuelOdometer] = useState("");
  const selectedVehicleForFuel = vehicles.find((v) => v.id === vehicleId);
  const fuelUnitForVehicle: { unit: string; label: string } | null = (() => {
    const ft = selectedVehicleForFuel?.fuelType;
    if (!ft) return null;
    if (ft === "ELECTRIC") return { unit: "kWh", label: "Units (kWh)" };
    if (ft === "CNG") return { unit: "kg", label: "Kg" };
    return { unit: "L", label: "Litres" };
  })();

  const isHospitalMode =
    type === "EXPENSE" && selectedCategory?.name?.toLowerCase() === "hospital";
  const [hospitalizationId, setHospitalizationId] = useState<string | null>(null);
  const [hospitalizationStage, setHospitalizationStage] = useState<
    "PRE" | "DURING" | "POST"
  >("DURING");
  const [hospitalPatientFilter, setHospitalPatientFilter] = useState<string>("");
  const { data: contactsForHospital } = useSWR<{
    members: { id: string; name: string }[];
  }>(isHospitalMode ? "/api/contacts" : null, fetcher);
  const hospitalContacts = contactsForHospital?.members ?? [];
  const { data: hospitalizationsData } = useSWR<{
    hospitalizations: {
      id: string;
      hospitalName: string;
      admittedAt: string;
      dischargedAt: string | null;
      patientContact: { id: string; name: string };
    }[];
  }>(
    isHospitalMode && hospitalPatientFilter
      ? `/api/hospitalizations?patientContactId=${hospitalPatientFilter}`
      : null,
    fetcher,
  );
  const episodes = hospitalizationsData?.hospitalizations ?? [];

  const amtNum = parseFloat(amount) || 0;
  // Pay-from picker grouped by funding-source kind so users scan by
  // category (Bank → Wallet → Cash → Debit Card → Credit Card) rather
  // than a flat alphabetical list.
  const sources = useMemo(() => {
    type Item = { value: string; label: string; sub: string; disabled: boolean };
    const buckets: Record<"BANK" | "WALLET" | "CASH" | "DEBIT" | "CREDIT", Item[]> = {
      BANK: [],
      WALLET: [],
      CASH: [],
      DEBIT: [],
      CREDIT: [],
    };
    for (const a of accounts) {
      if (a.kind === "CARD") continue; // companion card-accounts are surfaced via /api/cards
      if (a.kind !== "BANK" && a.kind !== "WALLET" && a.kind !== "CASH") continue;
      const insufficient = type === "EXPENSE" && amtNum > 0 && amtNum > a.balance;
      buckets[a.kind].push({
        value: `account:${a.id}`,
        label: formatAccountLabel(a.name, a.kind),
        sub: formatINR(a.balance),
        disabled: insufficient,
      });
    }
    if (type === "EXPENSE") {
      for (const c of cards) {
        const baseLabel = formatAccountLabel(c.name, "CARD");
        const label = c.last4 ? `${baseLabel} ••${c.last4}` : baseLabel;
        if (c.kind === "CREDIT") {
          const avail = c.availableLimit;
          const insufficient = avail != null && amtNum > 0 && amtNum > avail;
          buckets.CREDIT.push({
            value: `card:${c.id}`,
            label,
            sub: `${avail != null ? formatINR(avail) : "—"} avail`,
            disabled: insufficient,
          });
        } else {
          // Debit cards draw on a linked bank account; spendable is the
          // bank's balance, surfaced by the API as availableLimit.
          const avail = c.availableLimit;
          const insufficient = avail != null && amtNum > 0 && amtNum > avail;
          buckets.DEBIT.push({
            value: `card:${c.id}`,
            label,
            sub: avail != null ? formatINR(avail) : "—",
            disabled: insufficient,
          });
        }
      }
    }
    const groupOrder: { key: keyof typeof buckets; label: string }[] = [
      { key: "BANK", label: "Bank" },
      { key: "WALLET", label: "Wallet" },
      { key: "CASH", label: "Cash" },
      { key: "DEBIT", label: "Debit Card" },
      { key: "CREDIT", label: "Credit Card" },
    ];
    return groupOrder
      .filter((g) => buckets[g.key].length > 0)
      .map((g) => ({
        label: g.label,
        options: buckets[g.key].map((it) => ({
          value: it.value,
          label: it.label,
          hint: it.sub,
          disabled: it.disabled,
        })),
      }));
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

    if (
      isVehicleMode &&
      vehicleId &&
      createVehicleDoc &&
      !vehicleDocExpiryAt
    ) {
      setError(
        "Pick a new expiry date for the document — that's what the renewal reminder is anchored on.",
      );
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
      if (type === "EXPENSE" && beneficiaryContactId) {
        payload.beneficiaryContactId = beneficiaryContactId;
        payload.memberChargeType = chargeFlag;
      }
      if (isVehicleMode && vehicleId) payload.vehicleId = vehicleId;
      // Fuel sub-mode: persist litres/kWh/kg quantity + odometer so the
      // vehicle's fuel-summary endpoint can compute mileage.
      if (isFuelMode && vehicleId) {
        if (fuelQuantity) {
          payload.fuelQuantity = Number(fuelQuantity);
          payload.fuelUnit = fuelUnitForVehicle?.unit ?? "L";
        }
        if (fuelOdometer) payload.fuelOdometer = Number(fuelOdometer);
      }
      if (isHospitalMode && hospitalizationId) {
        payload.hospitalizationId = hospitalizationId;
        payload.hospitalizationStage = hospitalizationStage;
      }
      // Gold/Jewellery expense → stamp ORNAMENT so reports can split
      // ornament purchases from investment-grade gold.
      if (
        type === "EXPENSE" &&
        selectedCategory?.name?.toLowerCase() === "gold/jewellery"
      ) {
        payload.goldForm = "ORNAMENT";
      }
      if (tagSource.startsWith("crop:")) payload.cropBatchId = tagSource.slice(5);
      if (tagSource.startsWith("livestock:")) payload.livestockBatchId = tagSource.slice(10);
      if (tagSource.startsWith("event:")) payload.eventId = tagSource.slice(6);
      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Failed");
      } else {
        const newTxnId = body.id as string | undefined;
        toast.success(type === "INCOME" ? "Income recorded" : "Expense recorded");
        // Optional follow-up: also create a VehicleDocument so the
        // system schedules the next renewal reminder. Failure here is
        // surfaced as a warning toast; the transaction stays.
        let newVehicleDocId: string | null = null;
        if (
          isVehicleMode &&
          vehicleId &&
          createVehicleDoc &&
          vehicleDocExpiryAt
        ) {
          const docRes = await fetch(
            `/api/vehicles/${vehicleId}/documents`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                kind: vehicleDocKind,
                expiryAt: vehicleDocExpiryAt,
                number: vehicleDocNumber.trim() || null,
              }),
            },
          );
          if (!docRes.ok) {
            const dbody = await docRes.json().catch(() => ({}));
            toast.warning(
              `Transaction saved, but renewal reminder failed: ${
                dbody.error ?? "unknown error"
              }`,
            );
          } else {
            const dbody = await docRes.json().catch(() => ({}));
            newVehicleDocId = (dbody.id as string | undefined) ?? null;
            toast.success("Renewal reminder scheduled");
          }
        }
        // Smart-routed attachment upload — attaches to the most useful
        // owner based on what the user just created:
        //   - Vehicle doc was created → attach to the doc (cert lives
        //     with the doc; visible on /vehicles/<id>).
        //   - Event tagged          → attach to the event.
        //   - Otherwise             → attach to the transaction.
        if (receiptFiles.length > 0 && newTxnId) {
          const eventId = tagSource.startsWith("event:")
            ? tagSource.slice(6)
            : null;
          let ownerKind:
            | "VEHICLE_DOCUMENT"
            | "EVENT_DOCUMENT"
            | "TRANSACTION_RECEIPT";
          let ownerId: string;
          if (newVehicleDocId) {
            ownerKind = "VEHICLE_DOCUMENT";
            ownerId = newVehicleDocId;
          } else if (eventId) {
            ownerKind = "EVENT_DOCUMENT";
            ownerId = eventId;
          } else {
            ownerKind = "TRANSACTION_RECEIPT";
            ownerId = newTxnId;
          }
          const result = await uploadReceiptsToAttachment({
            files: receiptFiles,
            ownerKind,
            ownerId,
          });
          if (result.errors.length > 0) {
            toast.warning(
              `Transaction saved, but ${result.errors.length} of ${receiptFiles.length} file(s) failed: ${result.errors.join("; ")}`,
            );
          } else if (result.uploaded > 0) {
            toast.success(
              result.uploaded === 1
                ? "Receipt attached"
                : `${result.uploaded} receipts attached`,
            );
          }
        }
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
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-medium">
            {type === "INCOME" ? "To account" : "Pay from"}
          </span>
          <div className="mt-1">
            <NativeSelect
              value={paymentSource}
              onChange={setPaymentSource}
              options={sources}
            />
          </div>
        </label>
        <div className="block">
          <span className="text-xs font-medium">Category</span>
          <div className="mt-1">
            <CategoryCombobox
              value={categoryId || null}
              onChange={(id) => setCategoryId(id)}
              categories={categories.map((c) => ({
                id: c.id,
                name: c.name,
                parentCategoryId: c.parentCategoryId,
                group: c.group,
              }))}
              placeholder="— optional —"
              canCreate
              onRequestCreate={(typedText) => {
                setQuickCreateName(typedText);
                setQuickCreateOpen(true);
              }}
            />
          </div>
        </div>
        <CategoryQuickCreateDialog
          open={quickCreateOpen}
          onClose={() => setQuickCreateOpen(false)}
          initialName={quickCreateName}
          type={type}
          allCategories={categories.map((c) => ({
            id: c.id,
            name: c.name,
            parentCategoryId: c.parentCategoryId,
            group: c.group,
          }))}
          onCreated={(id) => setCategoryId(id)}
        />
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

      {isVehicleMode && (
        <div className="rounded-md border bg-muted/30 p-3">
          <div className="text-xs font-medium">Vehicle</div>
          <div className="text-[10px] text-muted-foreground">
            Tag this {selectedCategory?.name?.toLowerCase()} to a specific vehicle so
            running costs roll up on the Vehicles page.
          </div>
          <select
            className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm"
            value={vehicleId ?? ""}
            onChange={(e) => setVehicleId(e.target.value || null)}
          >
            <option value="">— pick a vehicle —</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
                {v.registrationNo ? ` · ${v.registrationNo}` : ""} ({v.kind.toLowerCase()})
              </option>
            ))}
          </select>
          {vehicles.length === 0 && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              No vehicles yet.{" "}
              <Link href="/vehicles" className="underline">
                Add a vehicle
              </Link>{" "}
              first, then come back.
            </p>
          )}

          {/* Fuel-fill metadata — appears when category is Fuel + a
              vehicle is picked. Unit label is driven by the vehicle's
              fuelType; if it's not set, prompt the user to update the
              vehicle first. */}
          {isFuelMode && vehicleId && (
            <div className="mt-3 border-t pt-3 space-y-2">
              <div className="text-xs font-medium">Fuel fill</div>
              {fuelUnitForVehicle ? (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="text-[10px] font-medium">
                        Quantity ({fuelUnitForVehicle.label})
                      </span>
                      <Input
                        inputMode="decimal"
                        value={fuelQuantity}
                        onChange={(e) =>
                          setFuelQuantity(
                            e.target.value.replace(/[^\d.]/g, "").slice(0, 10),
                          )
                        }
                        placeholder={
                          fuelUnitForVehicle.unit === "kWh" ? "12.5" : "8.45"
                        }
                        className="mt-0.5 h-8 text-xs"
                      />
                    </label>
                    <label className="block">
                      <span className="text-[10px] font-medium">
                        Odometer (km)
                      </span>
                      <Input
                        inputMode="numeric"
                        value={fuelOdometer}
                        onChange={(e) =>
                          setFuelOdometer(
                            e.target.value.replace(/\D/g, "").slice(0, 8),
                          )
                        }
                        placeholder="e.g. 42150"
                        className="mt-0.5 h-8 text-xs"
                      />
                    </label>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Both optional. Recording quantity + odometer on each fill
                    enables mileage tracking on the vehicle page.
                  </p>
                </>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  This vehicle has no fuel type set.{" "}
                  <Link
                    href={`/vehicles/${vehicleId}`}
                    className="underline"
                  >
                    Pick a fuel type
                  </Link>{" "}
                  to enable litre / kWh / kg tracking.
                </p>
              )}
            </div>
          )}

          {vehicleId && (
            <div className="mt-3 border-t pt-3">
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={createVehicleDoc}
                  onChange={(e) => setCreateVehicleDoc(e.target.checked)}
                />
                <span className="font-medium">
                  Also log this as a document renewal
                </span>
              </label>
              <p className="mt-1 ml-6 text-[10px] text-muted-foreground">
                Schedules a renewal reminder before the new expiry date so
                you don&apos;t miss the next one.
              </p>
              {createVehicleDoc && (
                <div className="mt-2 ml-6 grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-[10px] font-medium">Document</span>
                    <select
                      className="mt-0.5 w-full rounded-md border bg-background px-2 py-1.5 text-xs"
                      value={vehicleDocKind}
                      onChange={(e) =>
                        setVehicleDocKind(
                          e.target.value as typeof vehicleDocKind,
                        )
                      }
                    >
                      <option value="RC">RC book</option>
                      <option value="FC">Fitness Certificate</option>
                      <option value="PUC">Pollution (PUC)</option>
                      <option value="ROAD_TAX">Road tax</option>
                      <option value="INSURANCE_COPY">Insurance copy</option>
                      <option value="OTHER">Other</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-[10px] font-medium">New expiry</span>
                    <DateInput
                      value={vehicleDocExpiryAt}
                      onChange={(e) => setVehicleDocExpiryAt(e.target.value)}
                      className="mt-0.5 h-8 text-xs"
                    />
                  </label>
                  <label className="col-span-2 block">
                    <span className="text-[10px] font-medium">
                      Document #{" "}
                      <span className="font-normal text-muted-foreground">
                        (optional)
                      </span>
                    </span>
                    <Input
                      value={vehicleDocNumber}
                      onChange={(e) => setVehicleDocNumber(e.target.value)}
                      maxLength={80}
                      placeholder="As printed on the doc"
                      className="mt-0.5 h-8 text-xs"
                    />
                  </label>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {isHospitalMode && (
        <div className="rounded-md border bg-muted/30 p-3 space-y-2">
          <div className="text-xs font-medium">Hospitalization</div>
          <div className="text-[10px] text-muted-foreground">
            Tag this medical bill to a patient + episode + stage so it groups under
            Medical Records.
          </div>
          <div className="grid grid-cols-2 gap-2">
            <select
              className="rounded-md border bg-background px-3 py-2 text-sm"
              value={hospitalPatientFilter}
              onChange={(e) => {
                setHospitalPatientFilter(e.target.value);
                setHospitalizationId(null);
              }}
            >
              <option value="">— patient —</option>
              {hospitalContacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              className="rounded-md border bg-background px-3 py-2 text-sm"
              value={hospitalizationStage}
              onChange={(e) =>
                setHospitalizationStage(e.target.value as "PRE" | "DURING" | "POST")
              }
            >
              <option value="PRE">Pre-hospitalization</option>
              <option value="DURING">Hospitalization</option>
              <option value="POST">Post-hospitalization</option>
            </select>
          </div>
          {hospitalPatientFilter && (
            <select
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={hospitalizationId ?? ""}
              onChange={(e) => setHospitalizationId(e.target.value || null)}
            >
              <option value="">— pick episode —</option>
              {episodes.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.hospitalName} · admitted {new Date(h.admittedAt).toLocaleDateString()}
                </option>
              ))}
            </select>
          )}
          {hospitalContacts.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">
              No contacts yet.{" "}
              <Link href="/contacts" className="underline">
                Add the patient on Contacts
              </Link>
              .
            </p>
          ) : hospitalPatientFilter && episodes.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">
              No hospitalizations for this patient yet.{" "}
              <Link href="/medical" className="underline">
                Add one on Medical Records
              </Link>
              .
            </p>
          ) : null}
        </div>
      )}

      {(cropBatches.length > 0 ||
        livestockBatches.length > 0 ||
        events.length > 0) && (
        <label className="block">
          <span className="text-xs font-medium">
            Tag to batch / event{" "}
            <span className="font-normal text-muted-foreground">(optional)</span>
          </span>
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
                  events.length > 0 && {
                    label: "Events / Trips",
                    options: events.map((e) => {
                      const date = new Date(e.startedAt)
                        .toISOString()
                        .slice(0, 10);
                      return {
                        value: `event:${e.id}`,
                        label: `${e.name} · ${date} (${e.kind.toLowerCase()})`,
                      };
                    }),
                  },
                ].filter(Boolean) as NativeSelectGroup[]
              }
            />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Tag this transaction to a crop / livestock batch (per-batch P&amp;L) or
            to an event / trip (roll-up across categories).
          </p>
        </label>
      )}

      {type === "EXPENSE" && (
        <div className="rounded-md border bg-card p-4 space-y-3">
          <div>
            <span className="text-xs font-medium">Spent for a contact?</span>
            <div className="mt-1">
              <NativeSelect
                value={beneficiaryContactId}
                onChange={setBeneficiaryMemberId}
                placeholder="— optional, pick a contact —"
                options={contacts.map((m) => ({ value: m.id, label: m.name }))}
              />
            </div>
          </div>
          {beneficiaryContactId && (
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
                  Recover this from {contacts.find((m) => m.id === beneficiaryContactId)?.name ?? "them"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {chargeFlag === "RECOVERABLE"
                    ? "Adds to their Outstanding — settle later from the contact page."
                    : "Just tagged for reporting; no balance impact."}
                </span>
              </div>
            </label>
          )}
        </div>
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

      {(() => {
        // Predict where the receipt will land so we can show the right
        // size cap inline (matches what the server will enforce).
        const willAttachTo: keyof typeof ATTACHMENT_MAX_MB =
          isVehicleMode && vehicleId && createVehicleDoc && vehicleDocExpiryAt
            ? "VEHICLE_DOCUMENT"
            : tagSource.startsWith("event:")
              ? "EVENT_DOCUMENT"
              : "TRANSACTION_RECEIPT";
        const maxMB = ATTACHMENT_MAX_MB[willAttachTo];
        const destinationHint =
          willAttachTo === "VEHICLE_DOCUMENT"
            ? "the new vehicle document (visible on /vehicles)"
            : willAttachTo === "EVENT_DOCUMENT"
              ? "the linked event (visible on /events)"
              : "this transaction (visible on its edit dialog)";
        return (
          <div className="rounded-md border bg-muted/30 p-3 space-y-2">
            <div className="text-xs font-medium">
              Receipts / supporting files{" "}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </div>
            {receiptFiles.length > 0 && (
              <ul className="space-y-1">
                {receiptFiles.map((f, idx) => (
                  <li
                    key={`${f.name}-${f.size}-${idx}`}
                    className="flex items-center justify-between gap-2 rounded border bg-background px-2 py-1.5 text-xs"
                  >
                    <span className="truncate">
                      {f.name} ({Math.round(f.size / 1024)} KB)
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setReceiptFiles(receiptFiles.filter((_, i) => i !== idx))
                      }
                      className="underline hover:text-foreground shrink-0"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <input
              type="file"
              multiple
              accept="image/*,application/pdf"
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? []);
                const valid: File[] = [];
                for (const f of picked) {
                  if (f.size > maxMB * 1_000_000) {
                    setError(
                      `${f.name} is too large (limit ${maxMB} MB for ${destinationHint.split(" (")[0]})`,
                    );
                    continue;
                  }
                  valid.push(f);
                }
                if (valid.length > 0) setReceiptFiles([...receiptFiles, ...valid]);
                e.target.value = "";
              }}
              className="block w-full text-xs file:mr-2 file:rounded-md file:border file:bg-background file:px-2 file:py-1 file:text-xs file:font-medium"
            />
            <p className="text-[10px] text-muted-foreground">
              Will attach to {destinationHint}. Max {maxMB} MB per file.
            </p>
          </div>
        );
      })()}

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

type RefundOriginalTxn = {
  id: string;
  amount: number;
  description: string;
  date: string;
  cardId: string | null;
};

type CardStatementSummary = {
  id: string;
  periodStart: string;
  periodEnd: string;
  closedAt: string | null;
};

/**
 * Refund flow — posts type=INCOME, kind=REFUND on a CREDIT card so the
 * existing statement math (which already subtracts INCOME from totalDue)
 * applies the credit to the cycle covering the refund's date.
 *
 * The user can optionally link the refund to the original purchase. We
 * also surface a status line telling them which statement cycle the
 * refund will land in (current open / next / a previously-closed one)
 * so they're not surprised by retroactive adjustments.
 */
function RefundForm({ cards, onClose }: { cards: Card[]; onClose: () => void }) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [cardId, setCardId] = useState(cards[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(today);
  const [refundForTransactionId, setRefundForTransactionId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Recent expenses on the selected card — gives the user a quick way to
  // link the refund back to the original purchase. Capped at the 20 most
  // recent so the dropdown stays usable.
  const { data: recentTxnsData } = useSWR<{ transactions: RefundOriginalTxn[] }>(
    cardId ? `/api/transactions?cardId=${cardId}&type=EXPENSE&limit=20` : null,
    fetcher,
  );
  const recentExpenses = recentTxnsData?.transactions ?? [];

  // Statement summaries for the selected card — used to show the user
  // exactly which billing cycle this refund will affect.
  const selectedCard = cards.find((c) => c.id === cardId);
  const { data: statementsData } = useSWR<{ statements: CardStatementSummary[] }>(
    selectedCard?.accountId
      ? `/api/cards/${cardId}/statements`
      : null,
    fetcher,
  );
  const statements = useMemo(
    () => statementsData?.statements ?? [],
    [statementsData?.statements],
  );

  const cycleHint = useMemo(() => {
    if (!date || statements.length === 0) return null;
    const d = new Date(date).toISOString().slice(0, 10);
    const matching = statements.find(
      (s) => s.periodStart.slice(0, 10) <= d && d <= s.periodEnd.slice(0, 10),
    );
    if (!matching) {
      // Date is outside any materialised statement → falls in the
      // currently-open cycle (or a future one that hasn't been generated).
      return {
        tone: "info" as const,
        text: "Will reduce your current statement once it closes.",
      };
    }
    if (matching.closedAt) {
      return {
        tone: "warn" as const,
        text: `Date falls in a closed statement (${formatPeriod(matching)}). The refund will retroactively shrink that bill — only do this if your bank has actually credited the amount.`,
      };
    }
    return {
      tone: "info" as const,
      text: `Will be applied to the open statement (${formatPeriod(matching)}).`,
    };
  }, [date, statements]);

  function pickOriginal(id: string) {
    setRefundForTransactionId(id);
    if (!id) return;
    const orig = recentExpenses.find((t) => t.id === id);
    if (!orig) return;
    if (!amount) setAmount(String(orig.amount));
    if (!description) setDescription(`Refund: ${orig.description}`);
  }

  async function submit() {
    setError(null);
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      setError("Enter the refund amount");
      return;
    }
    if (!cardId) {
      setError("Pick a credit card");
      return;
    }
    if (!description.trim()) {
      setError("Add a short description");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "INCOME",
          kind: "REFUND",
          amount: amt,
          description: description.trim(),
          date,
          cardId,
          refundForTransactionId: refundForTransactionId || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Failed to record refund");
        return;
      }
      toast.success("Refund recorded");
      await mutateBalances();
      globalMutate(
        (k) =>
          typeof k === "string" &&
          (k.startsWith("/api/transactions") ||
            k.startsWith("/api/cards") ||
            k.startsWith("/api/dashboard")),
        undefined,
        { revalidate: true },
      );
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  if (cards.length === 0) {
    return (
      <div className="rounded-md border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
        Add a credit card first — refunds can only be posted to a card.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label className="text-xs font-medium">Credit card</label>
        <NativeSelect
          value={cardId}
          onChange={(v) => {
            setCardId(v);
            setRefundForTransactionId("");
          }}
          options={cards.map((c) => ({
            value: c.id,
            label: c.last4 ? `${c.name} · ••${c.last4}` : c.name,
          }))}
        />
      </div>

      {recentExpenses.length > 0 && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium">
            Refund of (optional)
          </label>
          <NativeSelect
            value={refundForTransactionId}
            onChange={pickOriginal}
            options={[
              { value: "", label: "— Standalone refund —" },
              ...recentExpenses.map((t) => ({
                value: t.id,
                label: `${t.date.slice(0, 10)} · ${formatINR(t.amount)} · ${t.description}`,
              })),
            ]}
          />
          <p className="text-[10px] text-muted-foreground">
            Linking helps reports net the refund against the original expense.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <label className="text-xs font-medium">Amount</label>
          <AmountInput value={amount} onChange={setAmount} />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium">Date</label>
          <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium">Description</label>
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. Refund: Amazon order #ABC123"
          maxLength={200}
        />
      </div>

      {cycleHint && (
        <div
          className={cn(
            "rounded-md border px-3 py-2 text-[11px]",
            cycleHint.tone === "warn"
              ? "border-amber-500/40 bg-amber-50 text-amber-900 dark:bg-amber-900/20 dark:text-amber-300"
              : "border-border bg-muted/40 text-muted-foreground",
          )}
        >
          {cycleHint.text}
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

      <DialogFooter className="pt-2">
        <Button variant="outline" type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" onClick={submit} disabled={submitting}>
          {submitting ? "Saving…" : "Record refund"}
        </Button>
      </DialogFooter>
    </div>
  );
}

function formatPeriod(s: { periodStart: string; periodEnd: string }) {
  const fmt = (d: string) =>
    new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  return `${fmt(s.periodStart)} – ${fmt(s.periodEnd)}`;
}

function TransferForm({ accounts, onClose }: { accounts: Account[]; onClose: () => void }) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [destinationKind, setDestinationKind] = useState<"ACCOUNT" | "MEMBER">(
    "ACCOUNT",
  );
  // For MEMBER mode: SENT = my account → person (outflow), RECEIVED =
  // person → my account (inflow). The single picked account plays "from"
  // when SENT and "to" when RECEIVED.
  const [direction, setDirection] = useState<"SENT" | "RECEIVED">("SENT");
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  // Single account picker shared across both directions of MEMBER mode.
  const [memberAccountId, setMemberAccountId] = useState("");
  // For the external flow we keep a free-text person name plus an optional
  // resolved memberId. Clicking a chip pins both; typing the input auto-links
  // to a matching member. On submit, if no memberId resolves we create one
  // with the typed name first.
  const [personName, setPersonName] = useState("");
  const [memberId, setMemberId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [expectBack, setExpectBack] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only fetch members once the user actually picks Person mode — no point
  // hitting /api/contacts for users who never use external transfers.
  const { data: membersData } = useSWR<{ members: Contact[] }>(
    destinationKind === "MEMBER" ? "/api/contacts" : null,
    fetcher,
  );
  const members = membersData?.members ?? [];

  async function submit() {
    setError(null);
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      setError("Enter an amount");
      return;
    }
    if (destinationKind === "ACCOUNT") {
      if (!fromId) {
        setError("Pick a source account");
        return;
      }
      if (!toId) {
        setError("Pick a destination account");
        return;
      }
      if (fromId === toId) {
        setError("From and to must differ");
        return;
      }
    } else {
      if (!memberAccountId) {
        setError("Pick your account");
        return;
      }
      if (!memberId && !personName.trim()) {
        setError("Pick a person or enter a name");
        return;
      }
    }
    setSubmitting(true);
    try {
      let resolvedMemberId = memberId;
      if (destinationKind === "MEMBER" && !resolvedMemberId) {
        const createRes = await fetch("/api/contacts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: personName.trim() }),
        });
        const createBody = await createRes.json();
        if (!createRes.ok) {
          setError(createBody.error ?? "Failed to create person");
          return;
        }
        resolvedMemberId = createBody.id;
        // Refresh the contacts list so future picks see the new entry.
        globalMutate("/api/contacts");
      }

      // Three shapes the API accepts:
      //   self-transfer:   from=account, to=account
      //   sent to person:  from=account, to=member
      //   received from:   from=member,  to=account
      const payload =
        destinationKind === "ACCOUNT"
          ? { fromAccountId: fromId, toAccountId: toId }
          : direction === "SENT"
            ? { fromAccountId: memberAccountId, toContactId: resolvedMemberId }
            : { fromContactId: resolvedMemberId, toAccountId: memberAccountId };

      const res = await fetch("/api/transfers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...payload,
          amount: amt,
          date,
          notes: notes.trim() || undefined,
          expectBack:
            destinationKind === "MEMBER" && direction === "SENT" && expectBack,
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
    <div className="space-y-4">
      {/* Transfer type toggle — between accounts vs to a person */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 mb-2">
          Transfer type
        </p>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setDestinationKind("ACCOUNT")}
            className={cn(
              "flex items-center gap-2 px-4 py-3 rounded-lg border text-sm font-medium transition-all",
              destinationKind === "ACCOUNT"
                ? "border-primary bg-primary/5 text-primary"
                : "border-border text-muted-foreground hover:border-muted-foreground/40",
            )}
          >
            <ArrowLeftRight className="h-4 w-4 shrink-0" />
            Between my accounts
          </button>
          <button
            type="button"
            onClick={() => setDestinationKind("MEMBER")}
            className={cn(
              "flex items-center gap-2 px-4 py-3 rounded-lg border text-sm font-medium transition-all",
              destinationKind === "MEMBER"
                ? "border-amber-600 bg-amber-50 text-amber-700"
                : "border-border text-muted-foreground hover:border-muted-foreground/40",
            )}
          >
            <ArrowUpRight className="h-4 w-4 shrink-0" />
            To someone
          </button>
        </div>
      </div>

      {/* Self transfer */}
      {destinationKind === "ACCOUNT" && (
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs text-muted-foreground">From</span>
            <div className="mt-1">
              <NativeSelect
                value={fromId}
                onChange={setFromId}
                options={groupAccountOptions(accounts, amtNum)}
              />
            </div>
          </label>
          <div className="flex items-center gap-2 px-1 text-muted-foreground/40">
            <div className="flex-1 h-px bg-border" />
            <ArrowLeftRight className="h-4 w-4 shrink-0" />
            <div className="flex-1 h-px bg-border" />
          </div>
          <label className="block">
            <span className="text-xs text-muted-foreground">To</span>
            <div className="mt-1">
              <NativeSelect
                value={toId}
                onChange={setToId}
                options={groupAccountOptions(
                  accounts.filter((a) => a.id !== fromId),
                  0,
                )}
              />
            </div>
          </label>
        </div>
      )}

      {/* External transfer — outflow (sent) or inflow (received) */}
      {destinationKind === "MEMBER" && (
        <div className="space-y-3">
          {/* Direction toggle: sent vs received */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setDirection("SENT")}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-all",
                direction === "SENT"
                  ? "border-amber-600 bg-amber-50 text-amber-700"
                  : "border-border text-muted-foreground hover:border-muted-foreground/40",
              )}
            >
              <ArrowUpRight className="h-4 w-4 shrink-0" />
              Money sent
            </button>
            <button
              type="button"
              onClick={() => setDirection("RECEIVED")}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-all",
                direction === "RECEIVED"
                  ? "border-emerald-600 bg-emerald-50 text-emerald-700"
                  : "border-border text-muted-foreground hover:border-muted-foreground/40",
              )}
            >
              <ArrowDownLeft className="h-4 w-4 shrink-0" />
              Money received
            </button>
          </div>

          <div className="rounded-lg border border-border divide-y divide-border overflow-hidden">
            {/* Top row: my account (the side of the picker depends on
                direction; visually it's always at the top to keep the
                user's account anchored). */}
            <div className="p-3 bg-muted/30">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 mb-2">
                {direction === "SENT" ? "From (my account)" : "To (my account)"}
              </p>
              <NativeSelect
                value={memberAccountId}
                onChange={setMemberAccountId}
                options={groupAccountOptions(
                  accounts,
                  direction === "SENT" ? amtNum : 0,
                )}
              />
            </div>
            <div className="flex items-center justify-center py-2 bg-background">
              {direction === "SENT" ? (
                <ArrowUpRight className="h-4 w-4 text-amber-600" />
              ) : (
                <ArrowDownLeft className="h-4 w-4 text-emerald-600" />
              )}
            </div>
            {/* Bottom row: the person */}
            <div className="p-3 bg-muted/30 space-y-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                {direction === "SENT" ? "To (person)" : "From (person)"}
              </p>
              {members.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {members.map((m) => {
                    const isSelected = memberId === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          setMemberId(m.id);
                          setPersonName(m.name);
                        }}
                        className={cn(
                          "px-2.5 py-1 rounded-md border text-xs font-medium transition-all",
                          isSelected
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-background text-muted-foreground hover:border-muted-foreground/40",
                        )}
                      >
                        {m.name}
                      </button>
                    );
                  })}
                </div>
              )}
              <Input
                value={personName}
                onChange={(e) => {
                  const v = e.target.value;
                  setPersonName(v);
                  // Auto-link if the typed name matches an existing member.
                  const match = members.find(
                    (m) => m.name.toLowerCase() === v.toLowerCase().trim(),
                  );
                  setMemberId(match ? match.id : "");
                }}
                placeholder="e.g. Wife, Cousin Raj"
                maxLength={80}
                className="bg-background"
              />
              {!memberId && personName.trim() && (
                <p className="text-[11px] text-muted-foreground">
                  No match — a new person “{personName.trim()}” will be added on save.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Amount + Date */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs text-muted-foreground">Amount (₹)</span>
          <AmountInput value={amount} onChange={setAmount} placeholder="0" />
        </label>
        <label className="block">
          <span className="text-xs text-muted-foreground">Date</span>
          <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>
      {destinationKind === "MEMBER" && direction === "SENT" && (
        <label className="flex items-start gap-2.5 cursor-pointer rounded-md border bg-card p-3">
          <input
            type="checkbox"
            checked={expectBack}
            onChange={(e) => setExpectBack(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-primary"
          />
          <div className="space-y-0.5">
            <span className="text-sm font-medium block">
              Expect this back from {personName.trim() || "them"}
            </span>
            <span className="text-xs text-muted-foreground">
              {expectBack
                ? "Adds to their Outstanding — settle later from the contact page."
                : "Just a transfer, no balance impact."}
            </span>
          </div>
        </label>
      )}
      <label className="block">
        <span className="text-xs text-muted-foreground">Notes</span>
        <Input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional — purpose, reference, etc."
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


type EmiLoan = {
  id: string;
  source: "BANK" | "HAND_FORMAL" | "CARD_EMI";
  lender: string;
  outstanding: number;
  emiAmount: number | null;
  active: boolean;
};

const EMI_SOURCE_LABEL: Record<EmiLoan["source"], string> = {
  BANK: "Bank",
  HAND_FORMAL: "Hand",
  CARD_EMI: "Card EMI",
};

function LoanEmiForm({
  accounts,
  onClose,
}: {
  accounts: Account[];
  onClose: () => void;
}) {
  // Loans are read-permission-gated per source, so fetch each source
  // separately — a no-source query falls back to the BANK feature check
  // and would silently filter out hand/card-EMI loans for users with
  // narrower permissions.
  const { data: bankData } = useSWR<{ loans: EmiLoan[] }>(
    "/api/loans?source=BANK",
    fetcher,
  );
  const { data: handData } = useSWR<{ loans: EmiLoan[] }>(
    "/api/loans?source=HAND_FORMAL",
    fetcher,
  );
  const { data: cardData } = useSWR<{ loans: EmiLoan[] }>(
    "/api/loans?source=CARD_EMI",
    fetcher,
  );
  const activeLoans = useMemo(
    () =>
      [
        ...(bankData?.loans ?? []),
        ...(handData?.loans ?? []),
        ...(cardData?.loans ?? []),
      ].filter((l) => l.active && l.outstanding > 0),
    [bankData, handData, cardData],
  );

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [loanId, setLoanId] = useState("");
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState(today);
  const [accountId, setAccountId] = useState("");
  const [notes, setNotes] = useState("");
  const [receiptFiles, setReceiptFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = activeLoans.find((l) => l.id === loanId) ?? null;

  // Auto-prefill the amount with the standard EMI when a loan is picked
  // (or with the outstanding when no EMI is on file). Capped at
  // outstanding so the final smaller EMI doesn't overpay.
  useEffect(() => {
    if (!selected) return;
    const suggested = Math.round(
      selected.emiAmount != null
        ? Math.min(selected.emiAmount, selected.outstanding)
        : selected.outstanding,
    );
    // eslint-disable-next-line react-hooks/set-state-in-effect -- seed amount on loan-pick
    setAmount(suggested > 0 ? String(suggested) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loanId]);

  const payable = accounts.filter((a) => a.kind !== "CARD");

  async function submit() {
    setError(null);
    if (!loanId) {
      setError("Pick a loan");
      return;
    }
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      setError("Enter an amount");
      return;
    }
    if (!accountId) {
      setError("Pick an account");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/loans/${loanId}/pay`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amount: amt,
          paidAt,
          accountId,
          notes: notes.trim() || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Failed");
        return;
      }
      toast.success("EMI paid");
      // Refresh every loans-list cache and the account balances.
      globalMutate(
        (k) => typeof k === "string" && k.startsWith("/api/loans"),
      );
      // Optional receipts — attach to the auto-created loan-payment
      // transaction. Failures surface as a warning toast.
      if (receiptFiles.length > 0 && body.transactionId) {
        const result = await uploadReceiptsToAttachment({
          files: receiptFiles,
          ownerKind: "TRANSACTION_RECEIPT",
          ownerId: body.transactionId,
        });
        if (result.errors.length > 0) {
          toast.warning(
            `EMI paid, but ${result.errors.length} of ${receiptFiles.length} file(s) failed: ${result.errors.join("; ")}`,
          );
        }
      }
      await mutateBalances();
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="text-xs font-medium">Loan</span>
        <div className="mt-1">
          <NativeSelect
            value={loanId}
            onChange={setLoanId}
            options={
              activeLoans.length === 0
                ? [{ value: "", label: "No active loans" }]
                : [
                    { value: "", label: "Pick a loan…" },
                    ...activeLoans.map((l) => ({
                      value: l.id,
                      label: `${l.lender} · ${EMI_SOURCE_LABEL[l.source]} · ${formatINR(l.outstanding)} due`,
                    })),
                  ]
            }
          />
        </div>
      </label>

      {selected && (
        <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Outstanding{" "}
          <span className="font-medium text-foreground tabular-nums">
            {formatINR(selected.outstanding)}
          </span>
          {selected.emiAmount != null && (
            <>
              {" · "}EMI{" "}
              <span className="tabular-nums">{formatINR(selected.emiAmount)}</span>
            </>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-medium">Amount (₹)</span>
          <AmountInput
            value={amount}
            onChange={setAmount}
            placeholder={
              selected?.emiAmount
                ? String(Math.round(selected.emiAmount))
                : "EMI amount"
            }
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium">Date</span>
          <DateInput value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
        </label>
      </div>

      <label className="block">
        <span className="text-xs font-medium">Pay from</span>
        <div className="mt-1">
          <NativeSelect
            value={accountId}
            onChange={setAccountId}
            options={groupAccountOptions(payable, Number(amount) || 0)}
          />
        </div>
      </label>

      <label className="block">
        <span className="text-xs font-medium">Notes</span>
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={200} />
      </label>

      <p className="text-xs text-muted-foreground">
        Server splits the payment into principal/interest using the standard
        reducing-balance rule. Tweak the split on the loan&rsquo;s detail page
        if you need to override.
      </p>

      <ReceiptStager
        value={receiptFiles}
        onChange={setReceiptFiles}
        ownerKind="TRANSACTION_RECEIPT"
        destinationHint="Attaches to the auto-created loan-payment transaction."
        onError={setError}
      />

      {error && <p className="text-sm text-destructive">{error}</p>}

      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={submitting}>
          {submitting ? "Saving…" : "Pay"}
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
  cards,
  categories,
  defaultCreatingNew = false,
  editingInvestmentId = null,
  onClose,
  onSwitchToExpense,
}: {
  accounts: Account[];
  cards: Card[];
  categories: Category[];
  /** When true, the form opens in "create new holding" mode instead of the
   * default "add a BUY/SELL transaction to an existing holding" picker. */
  defaultCreatingNew?: boolean;
  /** When set, fetch this investment + its BUY splits and pre-fill all
   * fields. Submit then PATCHes instead of POSTing. */
  editingInvestmentId?: string | null;
  onClose: () => void;
  /** Switch the parent dialog to the Expense tab. Used by the GOLD →
   * ORNAMENTS warning to nudge users toward recording jewellery as
   * expense (it shouldn't inflate net-worth). */
  onSwitchToExpense?: () => void;
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
  const [creatingNew, setCreatingNew] = useState(defaultCreatingNew);
  // Optional receipt staged before save — attaches to the auto-created
  // BUY/SELL transaction (or the new holding's seed transaction). Edit
  // flows can attach via the transaction edit dialog as before.
  const [investReceiptFiles, setInvestReceiptFiles] = useState<File[]>([]);
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
  const [newSumAssured, setNewSumAssured] = useState("");
  // Recurring-due fields used by SIP + INSURANCE. Without both, the API
  // silently skips the InvestmentReminder generation.
  const [newPremiumFrequency, setNewPremiumFrequency] = useState("MONTHLY");
  const [newNextDueDate, setNewNextDueDate] = useState("");
  // INSURANCE extras — same shape as the /insurance page's New Policy
  // dialog so the two flows stay in lockstep.
  const [insuranceExtras, setInsuranceExtras] = useState<InsurancePolicyExtras>(
    EMPTY_INSURANCE_EXTRAS,
  );
  // Lookups for the extras component — only fetched when relevant so
  // FD/SIP/Stock creators don't pay the round-trip.
  const isInsuranceCreate = creatingNew && newKind === "INSURANCE";
  const { data: insuranceContactsData } = useSWR<{
    members: { id: string; name: string }[];
  }>(isInsuranceCreate ? "/api/contacts" : null, fetcher);
  const insuranceContacts = insuranceContactsData?.members ?? [];
  const { data: insuranceVehiclesData } = useSWR<{
    vehicles: {
      id: string;
      name: string;
      kind: string;
      registrationNo: string | null;
    }[];
  }>(
    isInsuranceCreate && newPolicyType === "VEHICLE" ? "/api/vehicles" : null,
    fetcher,
  );
  const insuranceVehicles = insuranceVehiclesData?.vehicles ?? [];
  // GOLD-specific
  const [newGoldType, setNewGoldType] = useState<
    "ORNAMENTS" | "BAR" | "COIN" | "SGB" | "DIGITAL" | "ETF"
  >("ORNAMENTS");
  const [newGoldPurity, setNewGoldPurity] = useState("22K");
  const [newGoldWastage, setNewGoldWastage] = useState("");
  const [newGoldWastageMode, setNewGoldWastageMode] = useState<"RUPEE" | "PERCENT">("PERCENT");
  const [newGoldMaking, setNewGoldMaking] = useState("");
  const [newGoldMakingMode, setNewGoldMakingMode] = useState<"RUPEE" | "PERCENT">("PERCENT");
  // GST is split into CGST + SGST so the form mirrors the typical Indian
  // gold receipt (1.5% + 1.5% = 3% slab). For interstate purchases the
  // user can leave one at 0 and put the full slab in IGST-style on the
  // other.
  const [newGoldCgst, setNewGoldCgst] = useState("");
  const [newGoldCgstMode, setNewGoldCgstMode] = useState<"RUPEE" | "PERCENT">("PERCENT");
  const [newGoldSgst, setNewGoldSgst] = useState("");
  const [newGoldSgstMode, setNewGoldSgstMode] = useState<"RUPEE" | "PERCENT">("PERCENT");
  // Bill-level round-off (negative = round-down, positive = round-up).
  const [newGoldRoundOff, setNewGoldRoundOff] = useState("");
  // Ornament composition. The bill's gross weight is what the scale shows;
  // every entry in `stones` is one non-gold inclusion (diamond, ruby,
  // kundan, …) with its own weight + charge. Net gold = gross − Σ stone
  // weights, and that's what `quantity` × rate prices. None of these apply
  // to BAR / COIN / SGB / DIGITAL / ETF.
  const [newGoldGrossWeight, setNewGoldGrossWeight] = useState("");
  // Each stone row captures both the bill's split (`carats × ratePerCt`)
  // and the resulting `weight (g)` + `charge (₹)`. Auto-derivation keeps
  // them in sync: enter carats + rate, get charge; enter carats, get
  // weight (1ct = 0.2g). User-typed charge or weight overrides.
  const [newGoldStones, setNewGoldStones] = useState<
    {
      kind: string;
      weight: string;
      carats: string;
      ratePerCt: string;
      charge: string;
    }[]
  >([]);
  // Split-tender for gold: paying ₹X from N sources (cards + bank + wallet
  // mix). Each row's `source` is "account:<id>" or "card:<id>" — the same
  // encoding the income/expense form uses. Default to a single empty row;
  // amount is parsed at submit time.
  const [goldSplits, setGoldSplits] = useState<{ source: string; amount: string }[]>([
    { source: "", amount: "" },
  ]);
  // Edit mode: load existing investment + its BUY transactions, then
  // pre-fill every relevant field. Currently scoped to gold (where the
  // metadata complexity lives); other kinds fall through to existing
  // metadata handlers but the splits won't pre-fill.
  const isEditing = !!editingInvestmentId;
  const { data: editingData } = useSWR<{
    investment: {
      id: string;
      kind: string;
      name: string;
      institution: string | null;
      amount: number;
      quantity: number | null;
      purchasePrice: number | null;
      startedAt: string;
      notes: string | null;
      metadata: Record<string, unknown> | null;
      // Kind-specific fields pre-filled on edit so the form doesn't
      // silently drop them on re-save.
      symbol: string | null;
      exchange: string | null;
      currency: string | null;
      maturityAt: string | null;
      interestRate: number | null;
      policyNumber: string | null;
      policyType: string | null;
      premiumAmount: number | null;
      premiumFrequency: string | null;
      sumAssured: number | null;
      nextDueDate: string | null;
      nominee: string | null;
    };
    transactions: Array<{
      id: string;
      amount: number;
      action: "BUY" | "SELL" | null;
      accountId: string | null;
      cardId: string | null;
    }>;
  }>(
    editingInvestmentId ? `/api/investments/${editingInvestmentId}` : null,
    fetcher,
  );
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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- auto-pivot UI when no holdings exist
      setCreatingNew(true);
    }
  }, [action, creatingNew, investmentId, filteredHoldings.length, newKind]);

  // Live-price fetch — fires for both selected-holding and new-stock flows.
  // Also auto-flips currency to USD when the quote comes back in USD.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset stale quote on symbol change
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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear rate when leaving foreign-currency mode
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mirror selected holding's currency
    setInvestmentCurrency((selected.currency as "INR" | "USD") === "USD" ? "USD" : "INR");
  }, [selected]);

  // Sync the category chip to the active kind on first load.
  useEffect(() => {
    if (categoryId) return;
    const match = categories.find(
      (c) => categoryNameToKind(c.name) === activeKind,
    );
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot category default
    if (match) setCategoryId(match.id);
  }, [categories, activeKind, categoryId]);

  // Auto-compute amount when qty + price are entered. For foreign-currency
  // (e.g. USD stock), multiply by the exchange rate so `amount` stays in INR.
  // Skipped for gold-create mode — there `amount` is driven by the sum of
  // payment splits (since making/wastage/GST mean total paid > weight × rate).
  useEffect(() => {
    if (creatingNew && newKind === "GOLD") return;
    const q = parseFloat(quantity);
    const p = parseFloat(price);
    const r = isForeignCurrency ? parseFloat(exchangeRate) : 1;
    if (q > 0 && p > 0 && r > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- derived amount = qty × price × rate
      setAmount(String(Number((q * p * r).toFixed(2))));
    }
  }, [quantity, price, isForeignCurrency, exchangeRate, creatingNew, newKind]);

  function applyLivePrice() {
    if (livePrice) setPrice(livePrice.price.toFixed(2));
  }

  // Gold purchases routinely use multiple tenders (2 cards + bank, etc.),
  // so the create-new flow shows a splits repeater instead of a single
  // account picker. All other kinds keep the simple single picker.
  const isGoldCreate = creatingNew && newKind === "GOLD";

  // Bill total derived from the gold breakdown — gold value × wastage ×
  // making + Σ stones + CGST + SGST + round-off. This is what the user
  // owes and what `amount` should be: payment splits then validate
  // against it. Falls back to 0 when no breakdown is entered yet.
  const goldBillTotal = useMemo(() => {
    if (!isGoldCreate) return 0;
    const w = parseFloat(quantity) || 0;
    const r = parseFloat(price) || 0;
    const goldValue = w > 0 && r > 0 ? w * r : 0;
    if (goldValue <= 0) return 0;
    const ws = resolveAmount(newGoldWastage, newGoldWastageMode, goldValue);
    const mk = resolveAmount(newGoldMaking, newGoldMakingMode, goldValue);
    const stoneTotal =
      newGoldType === "ORNAMENTS"
        ? newGoldStones.reduce((a, s) => a + (parseFloat(s.charge) || 0), 0)
        : 0;
    const gstBase = goldValue + ws + mk + stoneTotal;
    const cgst = resolveAmount(newGoldCgst, newGoldCgstMode, gstBase);
    const sgst = resolveAmount(newGoldSgst, newGoldSgstMode, gstBase);
    const roundOff = parseFloat(newGoldRoundOff) || 0;
    return goldValue + ws + mk + stoneTotal + cgst + sgst + roundOff;
  }, [
    isGoldCreate,
    quantity,
    price,
    newGoldType,
    newGoldWastage,
    newGoldWastageMode,
    newGoldMaking,
    newGoldMakingMode,
    newGoldStones,
    newGoldCgst,
    newGoldCgstMode,
    newGoldSgst,
    newGoldSgstMode,
    newGoldRoundOff,
  ]);

  // For gold-create, `amount` mirrors the bill total. Splits then track
  // against it — a "Remaining" indicator surfaces the gap. When the
  // breakdown is empty (no weight/rate yet), fall back to sum of splits
  // so the form still works for a quick "just record what I paid" entry.
  useEffect(() => {
    if (!isGoldCreate) return;
    if (goldBillTotal > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- amount tracks bill total
      setAmount(String(Number(goldBillTotal.toFixed(2))));
      return;
    }
    const sum = goldSplits.reduce(
      (a, s) => a + (parseFloat(s.amount) || 0),
      0,
    );
    setAmount(sum > 0 ? String(Number(sum.toFixed(2))) : "");
  }, [isGoldCreate, goldBillTotal, goldSplits]);

  // For ornaments, the user enters gross weight + a list of stones; net
  // gold (= gross − Σ stone weights) is bound to `quantity` so qty × rate
  // stays the metal-only value. Skipped when gross is empty so a
  // type-switch from BAR → ORNAMENTS doesn't blow away an already-typed
  // weight.
  useEffect(() => {
    if (!isGoldCreate || newGoldType !== "ORNAMENTS") return;
    const gross = parseFloat(newGoldGrossWeight) || 0;
    if (gross <= 0) return;
    const stones = newGoldStones.reduce(
      (a, s) => a + (parseFloat(s.weight) || 0),
      0,
    );
    const net = Math.max(0, gross - stones);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- derived net weight = gross - Σ stones
    setQuantity(net > 0 ? Number(net.toFixed(3)).toString() : "");
  }, [isGoldCreate, newGoldType, newGoldGrossWeight, newGoldStones]);

// Stone-row derivations — carats is the bill's natural unit so we let
  // it drive both grams (1ct = 0.2g) and charge (carats × ratePerCt).
  // Weight is filled one-shot when empty so the user can override; charge
  // is recomputed whenever both carats + rate are non-zero so the
  // itemized split stays the source of truth.
  useEffect(() => {
    if (!isGoldCreate || newGoldType !== "ORNAMENTS") return;
    let changed = false;
    const next = newGoldStones.map((s) => {
      const ct = parseFloat(s.carats) || 0;
      const rate = parseFloat(s.ratePerCt) || 0;
      let weight = s.weight;
      let charge = s.charge;
      if (ct > 0 && !s.weight) {
        weight = Number((ct * 0.2).toFixed(3)).toString();
      }
      if (ct > 0 && rate > 0) {
        const derived = Number((ct * rate).toFixed(2)).toString();
        if (derived !== s.charge) charge = derived;
      }
      if (weight !== s.weight || charge !== s.charge) {
        changed = true;
        return { ...s, weight, charge };
      }
      return s;
    });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- only updates when a derived value actually changed
    if (changed) setNewGoldStones(next);
  }, [isGoldCreate, newGoldType, newGoldStones]);

  // Edit-mode pre-fill: when fetched investment data arrives, hydrate every
  // form field from it. Runs once per fetched record (keyed on id) so user
  // edits aren't clobbered by re-renders. Gold-only fields are read from
  // `metadata`; other kinds get the basics (name, amount, dates).
  const editingId = editingData?.investment.id;
  useEffect(() => {
    if (!editingData) return;
    const inv = editingData.investment;
    /* eslint-disable react-hooks/set-state-in-effect -- one-shot hydration when SWR resolves */
    setCreatingNew(true);
    setNewKind(inv.kind as typeof newKind);
    setNewName(inv.name);
    setAmount(String(inv.amount));
    setQuantity(inv.quantity != null ? String(inv.quantity) : "");
    setPrice(inv.purchasePrice != null ? String(inv.purchasePrice) : "");
    setDate(inv.startedAt.slice(0, 10));
    setDescription(inv.notes ?? "");

    // Kind-specific common fields. Loaded for every kind so re-saving a
    // non-gold edit doesn't blank out things the form's submit body would
    // otherwise resend as undefined for empty inputs.
    setNewInstitution(inv.institution ?? "");
    setNewSymbol(inv.symbol ?? "");
    setNewExchange(inv.exchange ?? "");
    setInvestmentCurrency(inv.currency === "USD" ? "USD" : "INR");
    setNewInterestRate(inv.interestRate != null ? String(inv.interestRate) : "");
    setNewMaturityAt(inv.maturityAt ? inv.maturityAt.slice(0, 10) : "");
    setNewPolicyNumber(inv.policyNumber ?? "");
    if (inv.policyType) setNewPolicyType(inv.policyType);
    setNewPremium(inv.premiumAmount != null ? String(inv.premiumAmount) : "");
    if (inv.premiumFrequency) setNewPremiumFrequency(inv.premiumFrequency);
    setNewNextDueDate(inv.nextDueDate ? inv.nextDueDate.slice(0, 10) : "");
    setNewNominee(inv.nominee ?? "");
    setNewSumAssured(inv.sumAssured != null ? String(inv.sumAssured) : "");

    if (inv.kind === "GOLD" && inv.metadata) {
      const m = inv.metadata as Record<string, unknown>;
      // Numbers saved as 0 (the result of `parseFloat("") || 0` on empty
      // inputs) render as empty so the field looks unset on edit and the
      // carat-derive effect doesn't see a phantom 0.
      const str = (v: unknown) => (v == null || v === 0 ? "" : String(v));
      const mode = (v: unknown): "RUPEE" | "PERCENT" =>
        v === "RUPEE" ? "RUPEE" : "PERCENT";
      setNewGoldType((m.goldType as typeof newGoldType) ?? "ORNAMENTS");
      setNewGoldPurity(str(m.purity) || "22K");
      setNewGoldGrossWeight(str(m.grossWeight));
      setNewGoldWastage(str(m.wastageInput));
      setNewGoldWastageMode(mode(m.wastageMode));
      setNewGoldMaking(str(m.makingInput));
      setNewGoldMakingMode(mode(m.makingMode));
      setNewGoldCgst(str(m.cgstInput));
      setNewGoldCgstMode(mode(m.cgstMode));
      setNewGoldSgst(str(m.sgstInput));
      setNewGoldSgstMode(mode(m.sgstMode));
      setNewGoldRoundOff(str(m.roundOff));
      const stones = Array.isArray(m.stones)
        ? (m.stones as Array<Record<string, unknown>>).map((s) => ({
            kind: str(s.kind),
            weight: str(s.weight),
            carats: str(s.carats),
            ratePerCt: str(s.ratePerCt),
            charge: str(s.charge),
          }))
        : [];
      setNewGoldStones(stones);
    }

    // Hydrate splits from existing BUY transactions. Encode using the
    // same "account:<id>" / "card:<id>" pattern the picker emits — card
    // wins because card spends carry both ids (companion account is
    // only there for balance routing).
    const buys = editingData.transactions.filter((t) => t.action === "BUY");
    if (buys.length > 0) {
      setGoldSplits(
        buys.map((t) => ({
          source: t.cardId
            ? `card:${t.cardId}`
            : t.accountId
              ? `account:${t.accountId}`
              : "",
          amount: String(t.amount),
        })),
      );
    }
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pre-fill should fire once per fetched id
  }, [editingId]);

  // Unified source list for the splits picker: spendable accounts +
  // credit cards. Mirrors the income/expense form's "account:<id>" /
  // "card:<id>" encoding (see IncomeExpenseForm.sources).
  const goldSourceOptions = useMemo(() => {
    type Item = { value: string; label: string; hint?: string };
    const buckets: Record<"BANK" | "WALLET" | "CASH" | "CREDIT", Item[]> = {
      BANK: [], WALLET: [], CASH: [], CREDIT: [],
    };
    for (const a of accounts) {
      if (a.kind === "BANK" || a.kind === "WALLET" || a.kind === "CASH") {
        buckets[a.kind].push({
          value: `account:${a.id}`,
          label: formatAccountLabel(a.name, a.kind),
          hint: `₹${a.balance.toLocaleString("en-IN")}`,
        });
      }
    }
    for (const c of cards) {
      if (c.kind !== "CREDIT") continue;
      const baseLabel = formatAccountLabel(c.name, "CARD");
      const label = c.last4 ? `${baseLabel} ••${c.last4}` : baseLabel;
      buckets.CREDIT.push({
        value: `card:${c.id}`,
        label,
        hint: c.availableLimit != null ? `₹${c.availableLimit.toLocaleString("en-IN")} avail` : undefined,
      });
    }
    const order: { key: keyof typeof buckets; label: string }[] = [
      { key: "BANK", label: "Bank" },
      { key: "WALLET", label: "Wallet" },
      { key: "CASH", label: "Cash" },
      { key: "CREDIT", label: "Credit Card" },
    ];
    return order.filter((g) => buckets[g.key].length > 0).map((g) => ({
      label: g.label,
      options: buckets[g.key],
    }));
  }, [accounts, cards]);

  const goldSplitsTotal = goldSplits.reduce(
    (a, s) => a + (parseFloat(s.amount) || 0),
    0,
  );

  // Map from "account:<id>" / "card:<id>" → { available, label } so each
  // split row can validate against the source's spendable balance / credit
  // limit. Cards expose `availableLimit` (debt headroom); accounts expose
  // `balance` (cash on hand).
  const goldSourceMeta = useMemo(() => {
    const m: Record<string, { available: number; label: string }> = {};
    for (const a of accounts) {
      if (a.kind === "BANK" || a.kind === "WALLET" || a.kind === "CASH") {
        m[`account:${a.id}`] = { available: a.balance, label: a.name };
      }
    }
    for (const c of cards) {
      if (c.kind === "CREDIT" && c.availableLimit != null) {
        m[`card:${c.id}`] = { available: c.availableLimit, label: c.name };
      }
    }
    return m;
  }, [accounts, cards]);

  // Sum allocations per source across all split rows so the same card /
  // account used twice doesn't appear "available" the second time.
  const goldUsedPerSource = useMemo(() => {
    const m: Record<string, number> = {};
    for (const s of goldSplits) {
      if (!s.source) continue;
      m[s.source] = (m[s.source] ?? 0) + (parseFloat(s.amount) || 0);
    }
    return m;
  }, [goldSplits]);

  // In edit mode, the existing BUY transactions already debited their
  // sources, so the live `availableLimit` / balance reported by the API
  // is *post-allocation*. Credit those amounts back per source so the
  // overflow check measures only the *delta* the user introduces, not
  // the entire existing allocation.
  const goldOriginalPerSource = useMemo(() => {
    const m: Record<string, number> = {};
    if (!editingData) return m;
    for (const t of editingData.transactions) {
      if (t.action !== "BUY") continue;
      const key = t.cardId
        ? `card:${t.cardId}`
        : t.accountId
          ? `account:${t.accountId}`
          : null;
      if (!key) continue;
      m[key] = (m[key] ?? 0) + t.amount;
    }
    return m;
  }, [editingData]);

  function goldEffectiveAvailable(source: string): number | null {
    const meta = goldSourceMeta[source];
    if (!meta) return null;
    return meta.available + (goldOriginalPerSource[source] ?? 0);
  }

  // Returns { over, available, label } for a row when the chosen source is
  // overspent across all rows allocated to it. `null` when the row is OK
  // or unconfigured. `available` is the *effective* available — what the
  // user can actually still spend, which in edit mode credits back the
  // original allocation for that source.
  function goldSplitOverflow(row: { source: string; amount: string }) {
    if (!row.source || !row.amount) return null;
    const meta = goldSourceMeta[row.source];
    if (!meta) return null;
    const effective = goldEffectiveAvailable(row.source) ?? meta.available;
    const used = goldUsedPerSource[row.source] ?? 0;
    if (used <= effective + 0.01) return null;
    return { over: used - effective, available: effective, label: meta.label };
  }

  async function submit() {
    setError(null);
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      setError("Enter an amount");
      return;
    }
    if (isGoldCreate) {
      if (goldSplits.length === 0) {
        setError("Add at least one payment source");
        return;
      }
      for (const s of goldSplits) {
        if (!s.source) {
          setError("Pick a source for every payment row");
          return;
        }
        const v = parseFloat(s.amount);
        if (!v || v <= 0) {
          setError("Enter an amount for every payment row");
          return;
        }
      }
      if (Math.abs(goldSplitsTotal - amt) > 0.01) {
        setError("Payment splits must add up to the total");
        return;
      }
      // Block when any source is overspent so we don't post transactions
      // that would push an account negative or a card past its limit. Use
      // effective availability so an edit that re-uses the original split
      // amounts isn't flagged as exceeding (the original BUYs are deleted
      // and recreated atomically, so their debit is being replayed).
      for (const [src, used] of Object.entries(goldUsedPerSource)) {
        const meta = goldSourceMeta[src];
        if (!meta) continue;
        const effective = goldEffectiveAvailable(src) ?? meta.available;
        if (used > effective + 0.01) {
          setError(
            `${meta.label}: ₹${used.toLocaleString("en-IN")} exceeds ₹${effective.toLocaleString("en-IN")} available`,
          );
          return;
        }
      }
    } else if (!accountId) {
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
    // Block submit on partially-filled member rows for new INSURANCE
    // policies — same guard as the /insurance NewPolicyDialog.
    const insuranceMemberIncomplete =
      creatingNew && newKind === "INSURANCE" && !isEditing
        ? incompleteMemberRows(insuranceExtras.members)
        : [];
    if (insuranceMemberIncomplete.length > 0) {
      const rows = insuranceMemberIncomplete
        .map(({ idx }) => `#${idx + 1}`)
        .join(", ");
      setError(
        `Member ${rows} ${insuranceMemberIncomplete.length === 1 ? "is" : "are"} missing required fields — pick a contact, or remove the row.`,
      );
      return;
    }
    setSubmitting(true);
    try {
      if (creatingNew) {
        // Create or update the holding. Edit mode PATCHes /api/investments/[id]
        // — the same payload shape works there because the schema is a partial
        // of the create base, and PATCH replaces BUY transactions when splits
        // are supplied.
        // Insurance extras (vehicle picker, life corporate fields, vehicle
        // coverage) merge in only when creating a fresh INSURANCE policy.
        const insuranceExtraPayload =
          newKind === "INSURANCE" && !isEditing
            ? buildInsuranceExtraPayload(insuranceExtras, newPolicyType)
            : {};
        const res = await fetch(
          isEditing ? `/api/investments/${editingInvestmentId}` : "/api/investments",
          {
            method: isEditing ? "PATCH" : "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
            ...insuranceExtraPayload,
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
              (newKind === "FD" || newKind === "RD" || newKind === "INSURANCE") &&
              newMaturityAt
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
            sumAssured:
              newKind === "INSURANCE" && newSumAssured
                ? Number(newSumAssured)
                : undefined,
            // SIP + INSURANCE share the recurring-due fields. Both are
            // required for the API to seed upcoming InvestmentReminder
            // rows; if either is blank the policy/SIP is created without
            // a schedule and the user can fill it in later.
            premiumFrequency:
              (newKind === "SIP" || newKind === "INSURANCE") && newNextDueDate
                ? newPremiumFrequency
                : undefined,
            nextDueDate:
              (newKind === "SIP" || newKind === "INSURANCE") && newNextDueDate
                ? newNextDueDate
                : undefined,
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
                    const grossW = parseFloat(newGoldGrossWeight) || 0;
                    const stoneRows = newGoldStones
                      .map((s) => ({
                        kind: s.kind.trim() || null,
                        weight: parseFloat(s.weight) || 0,
                        carats: parseFloat(s.carats) || 0,
                        ratePerCt: parseFloat(s.ratePerCt) || 0,
                        charge: parseFloat(s.charge) || 0,
                      }))
                      .filter(
                        (s) => s.weight > 0 || s.charge > 0 || s.carats > 0,
                      );
                    const stoneTotal = stoneRows.reduce(
                      (a, s) => a + s.charge,
                      0,
                    );
                    const taxBase =
                      goldValue + wastageAmt + makingAmt + stoneTotal;
                    const cgstAmt = resolveAmount(
                      newGoldCgst,
                      newGoldCgstMode,
                      taxBase,
                    );
                    const sgstAmt = resolveAmount(
                      newGoldSgst,
                      newGoldSgstMode,
                      taxBase,
                    );
                    const roundOff = parseFloat(newGoldRoundOff) || 0;
                    return {
                      goldType: newGoldType,
                      purity: newGoldPurity,
                      // Ornament composition (only meaningful when type =
                      // ORNAMENTS). `stones` is one row per non-gold
                      // inclusion — diamonds, ruby, kundan, etc. — each
                      // with weight, carats, rate/ct, and charge so future
                      // analytics can break down spend by stone kind.
                      ...(newGoldType === "ORNAMENTS" && {
                        grossWeight: grossW || null,
                        stones: stoneRows.length > 0 ? stoneRows : null,
                      }),
                      wastage: wastageAmt || null,
                      wastageInput: newGoldWastage || null,
                      wastageMode: newGoldWastageMode,
                      making: makingAmt || null,
                      makingInput: newGoldMaking || null,
                      makingMode: newGoldMakingMode,
                      cgst: cgstAmt || null,
                      cgstInput: newGoldCgst || null,
                      cgstMode: newGoldCgstMode,
                      sgst: sgstAmt || null,
                      sgstInput: newGoldSgst || null,
                      sgstMode: newGoldSgstMode,
                      roundOff: roundOff || null,
                    };
                  })()
                : undefined,
            currency: investmentCurrency,
            amount: amt,
            quantity: quantity ? Number(quantity) : undefined,
            purchasePrice: price ? Number(price) : undefined,
            purchaseExchangeRate:
              isForeignCurrency && exchangeRate
                ? Number(exchangeRate)
                : undefined,
            startedAt: date,
            accountId: isGoldCreate ? undefined : accountId,
            // Stamp the BUY transaction with the canonical GoldForm enum
            // for investment-grade gold (COIN / BAR / BISCUIT). SGB / DIGITAL
            // / ETF aren't physical gold and stay unstamped. ORNAMENTS is
            // blocked here — the warning UI nudges users to Expense.
            goldForm:
              newKind === "GOLD"
                ? newGoldType === "COIN"
                  ? "COIN"
                  : newGoldType === "BAR"
                    ? "BAR"
                    : undefined
                : undefined,
            splits: isGoldCreate
              ? goldSplits.map((s) => {
                  const [k, sid] = s.source.split(":");
                  return {
                    accountId: k === "account" ? sid : undefined,
                    cardId: k === "card" ? sid : undefined,
                    amount: Number(s.amount),
                  };
                })
              : undefined,
            isExisting: false,
            }),
          },
        );
        const body = await res.json();
        if (!res.ok) {
          setError(body.error ?? "Failed");
          return;
        }
        // For new INSURANCE policies, write the covered members /
        // beneficiaries. Each call is independent — a partial failure
        // surfaces a warning toast but the policy stays.
        if (
          newKind === "INSURANCE" &&
          !isEditing &&
          insuranceExtras.members.length > 0 &&
          body.id
        ) {
          const memberErrors = await submitPolicyMembers(
            body.id,
            insuranceExtras.members,
            newPremiumFrequency,
          );
          if (memberErrors.length > 0) {
            toast.warning(
              `Policy created, but some members failed: ${memberErrors.join("; ")}`,
            );
          }
        }
        toast.success(isEditing ? "Investment updated" : "Holding created and purchase recorded");
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
      if (investReceiptFiles.length > 0 && body.id) {
        const result = await uploadReceiptsToAttachment({
          files: investReceiptFiles,
          ownerKind: "TRANSACTION_RECEIPT",
          ownerId: body.id,
        });
        if (result.errors.length > 0) {
          toast.warning(
            `Saved, but ${result.errors.length} of ${investReceiptFiles.length} file(s) failed: ${result.errors.join("; ")}`,
          );
        }
      }
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
          ) : newKind === "INSURANCE" ? (
            // Pair Policy type + Insurer so the picker can suggest only
            // insurers that actually sell the chosen line of business.
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                <span className="text-xs font-medium">Insurer</span>
                <InsurerPicker
                  value={newName}
                  onChange={setNewName}
                  placeholder="Search insurers…"
                  filterCategories={insurerCategoriesForPolicyType(newPolicyType)}
                  autoFocus
                />
              </label>
            </div>
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-medium">Policy number</span>
                  <Input
                    value={newPolicyNumber}
                    onChange={(e) => setNewPolicyNumber(e.target.value)}
                    placeholder="Optional"
                  />
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-medium">
                    Premium <span className="font-normal text-muted-foreground">per cycle</span>
                  </span>
                  <AmountInput
                    value={newPremium}
                    onChange={setNewPremium}
                    placeholder="0"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium">Sum assured</span>
                  <AmountInput
                    value={newSumAssured}
                    onChange={setNewSumAssured}
                    placeholder="0"
                  />
                </label>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-medium">Premium cadence</span>
                  <div className="mt-1">
                    <NativeSelect
                      value={newPremiumFrequency}
                      onChange={setNewPremiumFrequency}
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
                    value={newNextDueDate}
                    onChange={(e) => setNewNextDueDate(e.target.value)}
                  />
                </label>
              </div>
              <label className="block">
                <span className="text-xs font-medium">Maturity / expiry</span>
                <DateInput
                  value={newMaturityAt}
                  onChange={(e) => setNewMaturityAt(e.target.value)}
                />
              </label>
              <p className="text-[11px] text-muted-foreground">
                Setting both <strong>cadence</strong> and <strong>next due</strong>
                {" "}seeds 12 upcoming reminders so the policy shows up under
                /reminders.
              </p>
              <InsurancePolicyExtrasFields
                policyType={newPolicyType}
                premiumFrequency={newPremiumFrequency}
                value={insuranceExtras}
                onChange={setInsuranceExtras}
                contacts={insuranceContacts}
                vehicles={insuranceVehicles}
              />
            </>
          )}

          {newKind === "SIP" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-medium">SIP cadence</span>
                <div className="mt-1">
                  <NativeSelect
                    value={newPremiumFrequency}
                    onChange={setNewPremiumFrequency}
                    options={[
                      { value: "MONTHLY", label: "Monthly" },
                      { value: "QUARTERLY", label: "Quarterly" },
                      { value: "HALF_YEARLY", label: "Half-yearly" },
                      { value: "YEARLY", label: "Yearly" },
                    ]}
                  />
                </div>
              </label>
              <label className="block">
                <span className="text-xs font-medium">Next instalment</span>
                <DateInput
                  value={newNextDueDate}
                  onChange={(e) => setNewNextDueDate(e.target.value)}
                />
              </label>
            </div>
          )}

          {newKind === "GOLD" && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-medium">Type</span>
                  <div className="mt-1">
                    <NativeSelect
                      value={newGoldType}
                      onChange={(v) => {
                        const next = v as typeof newGoldType;
                        // Hand the weight across the type swap so the user
                        // doesn't lose what they already typed: gross ↔
                        // single-weight when toggling ornaments on/off.
                        if (next === "ORNAMENTS" && newGoldType !== "ORNAMENTS") {
                          if (quantity && !newGoldGrossWeight) {
                            setNewGoldGrossWeight(quantity);
                          }
                        } else if (next !== "ORNAMENTS" && newGoldType === "ORNAMENTS") {
                          if (newGoldGrossWeight && !quantity) {
                            setQuantity(newGoldGrossWeight);
                          }
                          setNewGoldStones([]);
                        }
                        setNewGoldType(next);
                      }}
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
              {newGoldType === "ORNAMENTS" && (
                <div className="rounded-md border border-amber-300 bg-amber-50/40 p-3 text-xs dark:border-amber-700 dark:bg-amber-950/20">
                  <div className="font-medium">Ornaments are not investment-grade</div>
                  <div className="mt-0.5 text-muted-foreground">
                    Resale bleeds wastage + making — most households don&apos;t treat
                    jewellery as an investment. Record this on the{" "}
                    <button
                      type="button"
                      onClick={() => onSwitchToExpense?.()}
                      className="underline"
                    >
                      Expense tab
                    </button>{" "}
                    under <strong>Gold/Jewellery</strong> instead so it reduces this
                    month&apos;s cash without inflating net-worth.
                  </div>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-medium">
                    {newGoldType === "ORNAMENTS" ? "Gross weight (g)" : "Weight (g)"}
                  </span>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={newGoldType === "ORNAMENTS" ? newGoldGrossWeight : quantity}
                    onChange={(e) => {
                      if (newGoldType === "ORNAMENTS") setNewGoldGrossWeight(e.target.value);
                      else setQuantity(e.target.value);
                    }}
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
              {newGoldType === "ORNAMENTS" && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium">
                      Stones{" "}
                      <span className="font-normal text-muted-foreground">
                        — diamonds, kundan, etc. (optional)
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setNewGoldStones((rows) => [
                          ...rows,
                          {
                            kind: "",
                            weight: "",
                            carats: "",
                            ratePerCt: "",
                            charge: "",
                          },
                        ])
                      }
                      className="shrink-0 text-xs font-medium text-primary hover:underline"
                    >
                      + Add stone
                    </button>
                  </div>
                  {newGoldStones.map((row, i) => (
                    <div
                      key={i}
                      className="rounded-md border bg-muted/20 p-2 space-y-1.5"
                    >
                      <div className="flex items-start gap-2">
                        <Input
                          type="text"
                          value={row.kind}
                          onChange={(e) =>
                            setNewGoldStones((rows) =>
                              rows.map((r, idx) =>
                                idx === i ? { ...r, kind: e.target.value } : r,
                              ),
                            )
                          }
                          placeholder="Diamond, ruby, kundan…"
                          maxLength={40}
                          className="flex-1"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            setNewGoldStones((rows) =>
                              rows.filter((_, idx) => idx !== i),
                            )
                          }
                          aria-label="Remove stone"
                        >
                          ×
                        </Button>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                        <label className="block">
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            Weight (g)
                          </span>
                          <Input
                            type="number"
                            step="0.001"
                            min="0"
                            value={row.weight}
                            onChange={(e) =>
                              setNewGoldStones((rows) =>
                                rows.map((r, idx) =>
                                  idx === i ? { ...r, weight: e.target.value } : r,
                                ),
                              )
                            }
                            placeholder="0.000"
                          />
                        </label>
                        <label className="block">
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            Carats
                          </span>
                          <Input
                            type="number"
                            step="0.001"
                            min="0"
                            value={row.carats}
                            onChange={(e) =>
                              setNewGoldStones((rows) =>
                                rows.map((r, idx) =>
                                  idx === i ? { ...r, carats: e.target.value } : r,
                                ),
                              )
                            }
                            placeholder="0.000"
                          />
                        </label>
                        <label className="block">
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            Rate (₹/ct)
                          </span>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            value={row.ratePerCt}
                            onChange={(e) =>
                              setNewGoldStones((rows) =>
                                rows.map((r, idx) =>
                                  idx === i
                                    ? { ...r, ratePerCt: e.target.value }
                                    : r,
                                ),
                              )
                            }
                            placeholder="0"
                          />
                        </label>
                        <label className="block">
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            Charge (₹)
                          </span>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            value={row.charge}
                            onChange={(e) =>
                              setNewGoldStones((rows) =>
                                rows.map((r, idx) =>
                                  idx === i ? { ...r, charge: e.target.value } : r,
                                ),
                              )
                            }
                            placeholder="0.00"
                          />
                        </label>
                      </div>
                    </div>
                  ))}
                  {(() => {
                    const gross = parseFloat(newGoldGrossWeight) || 0;
                    const stoneTotal = newGoldStones.reduce(
                      (a, s) => a + (parseFloat(s.weight) || 0),
                      0,
                    );
                    const net = parseFloat(quantity) || 0;
                    if (gross <= 0) return null;
                    return (
                      <p className="text-xs text-muted-foreground">
                        Net gold weight:{" "}
                        <span className="font-semibold tabular-nums text-foreground">
                          {net.toFixed(3)}g
                        </span>
                        {stoneTotal > 0 && (
                          <>
                            {" "}
                            ({gross.toFixed(3)}g gross − {stoneTotal.toFixed(3)}g
                            stones)
                          </>
                        )}
                      </p>
                    );
                  })()}
                </div>
              )}
              {(() => {
                const w = parseFloat(quantity);
                const r = parseFloat(price);
                const goldValue = w > 0 && r > 0 ? w * r : 0;
                const ws = resolveAmount(newGoldWastage, newGoldWastageMode, goldValue);
                const mk = resolveAmount(newGoldMaking, newGoldMakingMode, goldValue);
                // Stones are taxed alongside gold on most household bills
                // (jewellers invoice everything at the gold slab unless
                // diamonds are billed separately). Pulling stone charges
                // into the GST base matches the typical receipt.
                const stoneTotal =
                  newGoldType === "ORNAMENTS"
                    ? newGoldStones.reduce(
                        (a, s) => a + (parseFloat(s.charge) || 0),
                        0,
                      )
                    : 0;
                const gstBase = goldValue + ws + mk + stoneTotal;
                const cgst = resolveAmount(newGoldCgst, newGoldCgstMode, gstBase);
                const sgst = resolveAmount(newGoldSgst, newGoldSgstMode, gstBase);
                const roundOff = parseFloat(newGoldRoundOff) || 0;
                return (
                  <>
                    <div
                      className={cn(
                        "grid gap-2",
                        newGoldType === "ORNAMENTS"
                          ? "grid-cols-2 md:grid-cols-5"
                          : "grid-cols-2 md:grid-cols-3",
                      )}
                    >
                      {newGoldType === "ORNAMENTS" && (
                        <>
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
                        </>
                      )}
                      <label className="block">
                        <span className="text-xs font-medium">CGST</span>
                        <PercentOrRupeeInput
                          value={newGoldCgst}
                          onValueChange={setNewGoldCgst}
                          mode={newGoldCgstMode}
                          onModeChange={setNewGoldCgstMode}
                          baseAmount={gstBase}
                        />
                      </label>
                      <label className="block">
                        <span className="text-xs font-medium">SGST</span>
                        <PercentOrRupeeInput
                          value={newGoldSgst}
                          onValueChange={setNewGoldSgst}
                          mode={newGoldSgstMode}
                          onModeChange={setNewGoldSgstMode}
                          baseAmount={gstBase}
                        />
                      </label>
                      <label className="block">
                        <span className="text-xs font-medium">
                          Round-off{" "}
                          <span className="font-normal text-muted-foreground">
                            (₹)
                          </span>
                        </span>
                        <Input
                          type="number"
                          step="0.01"
                          value={newGoldRoundOff}
                          onChange={(e) => setNewGoldRoundOff(e.target.value)}
                          placeholder="±0"
                        />
                      </label>
                    </div>
                    {goldValue > 0 && (
                      <GoldBreakdown
                        weight={w}
                        ratePerGram={r}
                        goldValue={goldValue}
                        wastage={ws}
                        making={mk}
                        cgst={cgst}
                        sgst={sgst}
                        roundOff={roundOff}
                        stones={
                          newGoldType === "ORNAMENTS"
                            ? newGoldStones
                                .map((s) => ({
                                  kind: s.kind.trim() || null,
                                  weight: parseFloat(s.weight) || 0,
                                  carats: parseFloat(s.carats) || 0,
                                  ratePerCt: parseFloat(s.ratePerCt) || 0,
                                  charge: parseFloat(s.charge) || 0,
                                }))
                                .filter(
                                  (s) =>
                                    s.weight > 0 || s.charge > 0 || s.carats > 0,
                                )
                            : undefined
                        }
                        showWastage={newGoldType === "ORNAMENTS"}
                        showMaking={newGoldType === "ORNAMENTS"}
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
          {isGoldCreate && (() => {
            const billTotal = goldBillTotal;
            const remaining = billTotal - goldSplitsTotal;
            const remainingClean = Math.abs(remaining) < 0.01 ? 0 : remaining;
            return (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium">Payment sources</span>
                  {billTotal > 0 ? (
                    <span
                      className={cn(
                        "text-xs tabular-nums",
                        remainingClean > 0
                          ? "text-amber-600 dark:text-amber-400"
                          : remainingClean < 0
                            ? "text-destructive"
                            : "text-emerald-600 dark:text-emerald-400",
                      )}
                    >
                      {remainingClean > 0
                        ? `Remaining: ₹${remainingClean.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`
                        : remainingClean < 0
                          ? `Over by ₹${Math.abs(remainingClean).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`
                          : "Fully paid"}
                    </span>
                  ) : (
                    <span className="text-xs tabular-nums text-muted-foreground">
                      Total: ₹{goldSplitsTotal.toLocaleString("en-IN")}
                    </span>
                  )}
                </div>
                {goldSplits.map((row, i) => {
                  const overflow = goldSplitOverflow(row);
                  const meta = row.source ? goldSourceMeta[row.source] : null;
                  return (
                    <div key={i} className="space-y-1">
                      <div className="flex items-start gap-2">
                        <div className="flex-1">
                          <NativeSelect
                            value={row.source}
                            onChange={(v) =>
                              setGoldSplits((rows) =>
                                rows.map((r, idx) =>
                                  idx === i ? { ...r, source: v } : r,
                                ),
                              )
                            }
                            options={goldSourceOptions}
                            placeholder="Pick source"
                          />
                        </div>
                        <Input
                          type="number"
                          inputMode="decimal"
                          placeholder="Amount"
                          value={row.amount}
                          onChange={(e) =>
                            setGoldSplits((rows) =>
                              rows.map((r, idx) =>
                                idx === i ? { ...r, amount: e.target.value } : r,
                              ),
                            )
                          }
                          className={cn(
                            "w-28",
                            overflow && "border-destructive focus-visible:border-destructive",
                          )}
                        />
                        {goldSplits.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() =>
                              setGoldSplits((rows) =>
                                rows.filter((_, idx) => idx !== i),
                              )
                            }
                            aria-label="Remove split"
                          >
                            ×
                          </Button>
                        )}
                      </div>
                      {overflow ? (
                        <p className="text-[11px] text-destructive">
                          Exceeds available by ₹
                          {overflow.over.toLocaleString("en-IN", {
                            maximumFractionDigits: 2,
                          })}{" "}
                          ({overflow.label}: ₹
                          {overflow.available.toLocaleString("en-IN")} available)
                        </p>
                      ) : meta && row.amount ? (
                        <p className="text-[11px] text-muted-foreground">
                          {meta.label}: ₹
                          {(
                            goldEffectiveAvailable(row.source) ?? meta.available
                          ).toLocaleString("en-IN")}{" "}
                          available
                        </p>
                      ) : null}
                    </div>
                  );
                })}
                <button
                  type="button"
                  onClick={() =>
                    setGoldSplits((rows) => [
                      ...rows,
                      {
                        source: "",
                        // Pre-fill the new row with whatever's left to pay
                        // so the user can just pick a source and submit.
                        amount:
                          remainingClean > 0
                            ? String(Number(remainingClean.toFixed(2)))
                            : "",
                      },
                    ])
                  }
                  className="text-xs font-medium text-primary hover:underline"
                >
                  + Add another source
                </button>
              </div>
            );
          })()}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium">
                {isGoldCreate
                  ? "Total (from payments)"
                  : `Amount ${isForeignCurrency ? "(₹ equivalent)" : "(₹)"}`}
              </span>
              <AmountInput
                value={amount}
                onChange={setAmount}
                placeholder="0"
                readOnly={isGoldCreate}
                className={isGoldCreate ? "bg-muted/50" : undefined}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium">Date</span>
              <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
          </div>

          {isQtyBased && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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

      {!isGoldCreate && (
        <label className="block">
          <span className="text-xs font-medium">
            {action === "BUY" ? "Pay from" : "Deposit to"}
          </span>
          <div className="mt-1">
            <NativeSelect
              value={accountId}
              onChange={setAccountId}
              options={groupAccountOptions(
                accounts,
                action === "BUY" ? Number(amount) || 0 : 0,
              )}
            />
          </div>
        </label>
      )}

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

      {!creatingNew && (
        <ReceiptStager
          value={investReceiptFiles}
          onChange={setInvestReceiptFiles}
          ownerKind="TRANSACTION_RECEIPT"
          destinationHint="Attaches to the BUY/SELL transaction (broker contract note, mutual-fund statement, etc.)."
          onError={setError}
        />
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={submitting}>
          {submitting
            ? "Saving…"
            : isEditing
              ? "Update"
              : action === "BUY"
                ? "Record purchase"
                : "Record sale"}
        </Button>
      </DialogFooter>
    </div>
  );
}
