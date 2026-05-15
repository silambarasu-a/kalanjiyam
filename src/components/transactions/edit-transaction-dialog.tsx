"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { AmountInput } from "@/components/ui/amount-input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AttachmentList } from "@/components/attachments/attachment-list";
import { CategoryCombobox } from "@/components/categories/category-combobox";

export type EditableTransaction = {
  id: string;
  /** Drives which categories load (INCOME / EXPENSE / INVESTMENT). */
  type: "INCOME" | "EXPENSE" | "INVESTMENT" | "HAND_LOAN" | "TRANSFER";
  amount: number;
  date: string; // ISO
  description: string;
  categoryId?: string | null;
  vehicleId?: string | null;
  eventId?: string | null;
  // Fuel-fill fields — only surfaced when the row has any of them set.
  // Caller (transactions list) populates from the API response so
  // edits round-trip correctly for fuel transactions.
  fuelQuantity?: number | null;
  fuelUnit?: string | null;
  fuelOdometer?: number | null;
};

type CategoryLite = {
  id: string;
  name: string;
  parentCategoryId: string | null;
  group: string | null;
};

type VehicleLite = {
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
};

type EventLite = {
  id: string;
  name: string;
  kind: string;
  startedAt: string;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function EditTransactionDialog({
  transaction,
  open,
  onOpenChange,
  onSaved,
}: {
  transaction: EditableTransaction | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful PATCH so the caller can refetch / refresh. */
  onSaved?: () => void | Promise<void>;
}) {
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [vehicleId, setVehicleId] = useState<string>("");
  const [eventId, setEventId] = useState<string>("");
  const [fuelQuantity, setFuelQuantity] = useState("");
  const [fuelOdometer, setFuelOdometer] = useState("");
  const [editNote, setEditNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lookups only fired while the dialog is open. Categories scoped by
  // the transaction's type so the combobox doesn't surface income
  // categories on an expense (or vice versa).
  const txType = transaction?.type;
  const { data: categoriesData } = useSWR<{ categories: CategoryLite[] }>(
    open && txType ? `/api/categories?type=${txType}` : null,
    fetcher,
  );
  const categories = categoriesData?.categories ?? [];
  // Detect vehicle / fuel category by the selected categoryId so the
  // dialog surfaces the right pickers when the user changes category
  // mid-edit (e.g. re-classifying a generic expense as "Fuel"). Same
  // match table as the new-transaction dialog.
  const VEHICLE_CATEGORY_NAMES = new Set([
    "vehicle purchase",
    "vehicle service",
    "fuel",
  ]);
  const selectedCategory = categories.find((c) => c.id === categoryId);
  const isVehicleCategory =
    !!selectedCategory?.name &&
    VEHICLE_CATEGORY_NAMES.has(selectedCategory.name.toLowerCase());
  const isFuelCategory =
    selectedCategory?.name?.toLowerCase() === "fuel";
  // Vehicles list — fetched when the row is already tagged OR when the
  // user has selected a vehicle-related category (so the picker appears
  // immediately after the category change without waiting for the next
  // open).
  const needsVehicles = !!transaction?.vehicleId || isVehicleCategory;
  const { data: vehiclesData } = useSWR<{ vehicles: VehicleLite[] }>(
    open && needsVehicles ? "/api/vehicles" : null,
    fetcher,
  );
  const vehicles = vehiclesData?.vehicles ?? [];
  const selectedVehicleForFuel = vehicles.find((v) => v.id === vehicleId);
  const fuelUnitForVehicle: { unit: string; label: string } | null = (() => {
    const ft = selectedVehicleForFuel?.fuelType;
    if (!ft) return null;
    if (ft === "ELECTRIC") return { unit: "kWh", label: "Units (kWh)" };
    if (ft === "CNG") return { unit: "kg", label: "Kg" };
    return { unit: "L", label: "Litres" };
  })();
  const { data: eventsData } = useSWR<{ events: EventLite[] }>(
    open ? "/api/events?status=all" : null,
    fetcher,
  );
  const events = eventsData?.events ?? [];

  // Re-seed the form whenever a different transaction is loaded.
  const txId = transaction?.id;
  useEffect(() => {
    if (!transaction) return;
    /* eslint-disable react-hooks/set-state-in-effect -- form hydration on dialog open */
    setAmount(String(Math.round(transaction.amount)));
    setDate(transaction.date.slice(0, 10));
    setDescription(transaction.description);
    setCategoryId(transaction.categoryId ?? "");
    setVehicleId(transaction.vehicleId ?? "");
    setEventId(transaction.eventId ?? "");
    setFuelQuantity(
      transaction.fuelQuantity != null ? String(transaction.fuelQuantity) : "",
    );
    setFuelOdometer(
      transaction.fuelOdometer != null ? String(transaction.fuelOdometer) : "",
    );
    setEditNote("");
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txId]);

  async function submit() {
    if (!transaction) return;
    setError(null);
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      setError("Enter an amount");
      return;
    }
    if (!description.trim()) {
      setError("Enter a description");
      return;
    }
    setSubmitting(true);
    try {
      // Echo fuel fields back when:
      //  - the row originally had any of them (round-trip an existing
      //    fuel transaction), OR
      //  - the user re-categorised this row to Fuel + picked a vehicle
      //    (so the new fuel fields they typed actually persist).
      // Otherwise omit the keys entirely so PATCH treats them as
      // "unchanged" — never silently null out unrelated rows.
      const hadFuel =
        transaction.fuelQuantity != null ||
        transaction.fuelOdometer != null ||
        transaction.fuelUnit != null;
      const shouldWriteFuel = hadFuel || (isFuelCategory && !!vehicleId);
      const res = await fetch(`/api/transactions/${transaction.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amount: amt,
          date,
          description: description.trim(),
          categoryId: categoryId || null,
          // Only echo vehicleId back if it was originally set — same
          // reason as fuel fields. Don't silently tag an untagged row.
          ...(transaction.vehicleId !== undefined
            ? { vehicleId: vehicleId || null }
            : {}),
          eventId: eventId || null,
          ...(shouldWriteFuel
            ? {
                fuelQuantity: fuelQuantity ? Number(fuelQuantity) : null,
                fuelOdometer: fuelOdometer ? Number(fuelOdometer) : null,
                // For new-fuel-on-edit, write the unit derived from
                // the vehicle's fuelType. For existing fuel rows we
                // leave the unit alone (omit the key) so a converted
                // vehicle doesn't rewrite history.
                ...(hadFuel
                  ? {}
                  : {
                      fuelUnit: fuelUnitForVehicle?.unit ?? "L",
                    }),
              }
            : {}),
          editNote: editNote.trim() || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}) as { error?: string });
      if (!res.ok) {
        setError(body.error ?? "Failed to update");
        return;
      }
      toast.success("Transaction updated");
      await onSaved?.();
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(28rem,calc(100%-2rem))]">
        <DialogHeader>
          <DialogTitle>Edit transaction</DialogTitle>
        </DialogHeader>
        {transaction && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-medium">Amount (₹)</span>
                <AmountInput value={amount} onChange={setAmount} autoFocus />
              </label>
              <label className="block">
                <span className="text-xs font-medium">Date</span>
                <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
            </div>
            <label className="block">
              <span className="text-xs font-medium">Description</span>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={200}
              />
            </label>
            {/* Category picker — same combobox the new-transaction
                dialog uses, scoped to the row's transaction type so
                income categories don't surface for expense rows. */}
            {(transaction.type === "INCOME" ||
              transaction.type === "EXPENSE" ||
              transaction.type === "INVESTMENT") && (
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
                    placeholder="— uncategorised —"
                  />
                </div>
              </div>
            )}
            {/* Vehicle picker: appears when the row is already tagged
                OR when the selected category is vehicle-related. */}
            {(transaction.vehicleId || isVehicleCategory) && (
              <label className="block">
                <span className="text-xs font-medium">
                  {isVehicleCategory ? "Vehicle" : "Tagged vehicle"}
                </span>
                <NativeSelect
                  value={vehicleId}
                  onChange={(v) => setVehicleId(v)}
                  options={[
                    {
                      value: "",
                      label: isVehicleCategory
                        ? "— pick a vehicle —"
                        : "— untag —",
                    },
                    ...vehicles.map((v) => ({
                      value: v.id,
                      label: `${v.name}${v.registrationNo ? ` · ${v.registrationNo}` : ""} (${v.kind.toLowerCase()})`,
                    })),
                  ]}
                />
                <span className="mt-1 block text-[10px] text-muted-foreground">
                  {isVehicleCategory
                    ? "Pick the vehicle this expense is for — running costs roll up on /vehicles."
                    : "Moves this transaction's running-cost contribution to another vehicle, or clears the tag."}
                </span>
              </label>
            )}
            {/* Fuel quantity + odometer: appears for Fuel category + a
                vehicle picked, even if the original row had no fuel
                fields recorded. */}
            {isFuelCategory && vehicleId && fuelUnitForVehicle && (
              <div className="rounded-md border bg-muted/30 p-3 space-y-2">
                <div className="text-xs font-medium">Fuel fill</div>
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
                    <span className="text-[10px] font-medium">Odometer (km)</span>
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
                  Both optional. Captured to compute mileage on the vehicle
                  page.
                </p>
              </div>
            )}
            {/* Legacy fuel section for rows that have fuel data but
                whose category isn't Fuel — kept so edits round-trip. */}
            {!isFuelCategory &&
              (transaction.fuelQuantity != null ||
              transaction.fuelOdometer != null) && (
              <div className="rounded-md border bg-muted/30 p-3 space-y-2">
                <div className="text-xs font-medium">Fuel fill</div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-[10px] font-medium">
                      Quantity{" "}
                      <span className="font-normal text-muted-foreground">
                        ({transaction.fuelUnit ?? "L"})
                      </span>
                    </span>
                    <Input
                      inputMode="decimal"
                      value={fuelQuantity}
                      onChange={(e) =>
                        setFuelQuantity(
                          e.target.value.replace(/[^\d.]/g, "").slice(0, 10),
                        )
                      }
                      className="mt-0.5 h-8 text-xs"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] font-medium">Odometer (km)</span>
                    <Input
                      inputMode="numeric"
                      value={fuelOdometer}
                      onChange={(e) =>
                        setFuelOdometer(
                          e.target.value.replace(/\D/g, "").slice(0, 8),
                        )
                      }
                      className="mt-0.5 h-8 text-xs"
                    />
                  </label>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Clearing either field re-saves it as empty; mileage on
                  the vehicle page recalculates automatically.
                </p>
              </div>
            )}
            <label className="block">
              <span className="text-xs font-medium">
                Tag to event / trip{" "}
                <span className="text-muted-foreground">(optional)</span>
              </span>
              <NativeSelect
                value={eventId}
                onChange={(v) => setEventId(v)}
                options={[
                  { value: "", label: "— none —" },
                  ...events.map((e) => {
                    const date = new Date(e.startedAt)
                      .toISOString()
                      .slice(0, 10);
                    return {
                      value: e.id,
                      label: `${e.name} · ${date} (${e.kind.toLowerCase()})`,
                    };
                  }),
                ]}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium">
                Edit note <span className="text-muted-foreground">(optional)</span>
              </span>
              <Input
                value={editNote}
                onChange={(e) => setEditNote(e.target.value)}
                maxLength={200}
                placeholder="Why are you editing?"
              />
            </label>
            <p className="text-[11px] text-muted-foreground">
              Linked records — loan outstanding, investment holdings, wage and
              feed logs — are kept in sync automatically.
            </p>
            <div className="rounded-md border bg-muted/30 p-3 space-y-2">
              <div className="text-xs font-medium">Receipts / supporting files</div>
              <AttachmentList
                ownerKind="TRANSACTION_RECEIPT"
                ownerId={transaction.id}
                emptyMessage="No receipts attached. Upload PDF or image (max 50 MB)."
                accept="image/*,application/pdf"
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
