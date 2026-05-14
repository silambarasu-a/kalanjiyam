"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { Car, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AmountInput } from "@/components/ui/amount-input";
import { DateInput } from "@/components/ui/date-input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type VehicleKind = "BIKE" | "CAR" | "TRACTOR" | "TRUCK" | "SCOOTER" | "OTHER";
type VehicleFuelType =
  | "PETROL"
  | "DIESEL"
  | "CNG"
  | "LPG"
  | "ELECTRIC"
  | "HYBRID"
  | "OTHER";
const FUEL_TYPE_OPTIONS: { value: VehicleFuelType; label: string }[] = [
  { value: "PETROL", label: "Petrol" },
  { value: "DIESEL", label: "Diesel" },
  { value: "CNG", label: "CNG" },
  { value: "LPG", label: "LPG" },
  { value: "ELECTRIC", label: "Electric (EV)" },
  { value: "HYBRID", label: "Hybrid" },
  { value: "OTHER", label: "Other" },
];

type Vehicle = {
  id: string;
  kind: VehicleKind;
  name: string;
  make: string | null;
  model: string | null;
  year: number | null;
  registrationNo: string | null;
  purchaseDate: string | null;
  purchasePrice: number | null;
  active: boolean;
  notes: string | null;
  ownerContact: { id: string; name: string };
  disposedAt: string | null;
  disposalKind: string | null;
  counts: {
    insurances: number;
    loans: number;
    claims: number;
    transactions: number;
  };
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const KIND_OPTIONS: { value: VehicleKind; label: string }[] = [
  { value: "CAR", label: "Car" },
  { value: "BIKE", label: "Bike" },
  { value: "SCOOTER", label: "Scooter" },
  { value: "TRACTOR", label: "Tractor" },
  { value: "TRUCK", label: "Truck" },
  { value: "OTHER", label: "Other" },
];

export default function VehiclesPage() {
  const { data, isLoading } = useSWR<{ vehicles: Vehicle[] }>("/api/vehicles", fetcher);
  const [open, setOpen] = useState(false);
  const [showDisposed, setShowDisposed] = useState(false);
  const allVehicles = data?.vehicles ?? [];
  const disposedCount = allVehicles.filter((v) => v.disposedAt).length;
  const vehicles = showDisposed
    ? allVehicles
    : allVehicles.filter((v) => !v.disposedAt);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Vehicles</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Bikes, cars, tractors — anything you fuel, service, or insure. Tag
            purchase / service / fuel transactions to a vehicle to see its running cost.
          </p>
        </div>
        <Button onClick={() => setOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" /> New vehicle
        </Button>
      </div>

      {disposedCount > 0 && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={showDisposed}
            onChange={(e) => setShowDisposed(e.target.checked)}
          />
          <span>
            Show {disposedCount} disposed vehicle{disposedCount === 1 ? "" : "s"}
          </span>
        </label>
      )}

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!isLoading && vehicles.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {showDisposed ? "No vehicles yet." : "No active vehicles."}
        </p>
      )}

      <div className="rounded-lg border bg-card divide-y">
        {vehicles.map((v) => (
          <VehicleRow key={v.id} vehicle={v} />
        ))}
      </div>

      <VehicleDialog open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

function VehicleRow({ vehicle }: { vehicle: Vehicle }) {
  return (
    <Link
      href={`/vehicles/${vehicle.id}`}
      className="flex items-start justify-between gap-3 p-4 hover:bg-muted/40"
    >
      <div className="flex items-start gap-3">
        <Car className="mt-0.5 h-4 w-4 text-muted-foreground" />
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium">{vehicle.name}</span>
            <span className="rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              {vehicle.kind}
            </span>
            {vehicle.disposedAt ? (
              <span className="rounded-full border border-amber-300 bg-amber-50/40 px-2 py-0.5 text-[10px] uppercase tracking-wide text-amber-700 dark:border-amber-700 dark:bg-amber-950/20 dark:text-amber-300">
                {vehicle.disposalKind?.replace("_", " ").toLowerCase() ?? "disposed"}
              </span>
            ) : (
              !vehicle.active && (
                <span className="rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  Inactive
                </span>
              )
            )}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {[vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(" · ") || "—"}
            {vehicle.registrationNo ? ` · ${vehicle.registrationNo}` : ""}
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            Owner: {vehicle.ownerContact.name}
          </div>
        </div>
      </div>
      <div className="text-right text-xs text-muted-foreground">
        {vehicle.counts.transactions > 0 && (
          <div>
            {vehicle.counts.transactions} txn{vehicle.counts.transactions === 1 ? "" : "s"}
          </div>
        )}
        {vehicle.counts.insurances > 0 && (
          <div>
            {vehicle.counts.insurances} polic{vehicle.counts.insurances === 1 ? "y" : "ies"}
          </div>
        )}
        {vehicle.counts.loans > 0 && (
          <div>
            {vehicle.counts.loans} loan{vehicle.counts.loans === 1 ? "" : "s"}
          </div>
        )}
      </div>
    </Link>
  );
}

function VehicleDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { data: contactsData } = useSWR<{ members: { id: string; name: string }[] }>(
    open ? "/api/contacts" : null,
    fetcher,
  );
  const contacts = contactsData?.members ?? [];

  const [kind, setKind] = useState<VehicleKind>("CAR");
  const [name, setName] = useState("");
  const [ownerContactId, setOwnerContactId] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [registrationNo, setRegistrationNo] = useState("");
  const [fuelType, setFuelType] = useState<VehicleFuelType | "">("");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [odometerStart, setOdometerStart] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- reset form on dialog open */
    setKind("CAR");
    setName("");
    setOwnerContactId("");
    setMake("");
    setModel("");
    setYear("");
    setRegistrationNo("");
    setFuelType("");
    setPurchaseDate("");
    setPurchasePrice("");
    setOdometerStart("");
    setNotes("");
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open]);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        kind,
        name: name.trim(),
        ownerContactId,
        make: make.trim() || undefined,
        model: model.trim() || undefined,
        year: year ? Number(year) : undefined,
        registrationNo: registrationNo.trim() || undefined,
        fuelType: fuelType || undefined,
        purchaseDate: purchaseDate || undefined,
        purchasePrice: purchasePrice ? Number(purchasePrice) : undefined,
        odometerStart: odometerStart ? Number(odometerStart) : undefined,
        notes: notes.trim() || undefined,
      };
      const res = await fetch("/api/vehicles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) setError(body.error ?? "Failed");
      else {
        globalMutate("/api/vehicles");
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
          <DialogTitle>New vehicle</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium">Type</span>
              <select
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={kind}
                onChange={(e) => setKind(e.target.value as VehicleKind)}
              >
                {KIND_OPTIONS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium">Owner</span>
              <select
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={ownerContactId}
                onChange={(e) => setOwnerContactId(e.target.value)}
              >
                <option value="">Select contact…</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {contacts.length === 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  No contacts yet.{" "}
                  <Link href="/contacts" className="underline">
                    Add a family member
                  </Link>
                  .
                </p>
              )}
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium">Name</span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Red Bullet, Family Swift, Sonalika 50HP"
              maxLength={80}
              autoFocus
            />
          </label>
          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="text-xs font-medium">Make</span>
              <Input value={make} onChange={(e) => setMake(e.target.value)} maxLength={60} />
            </label>
            <label className="block">
              <span className="text-xs font-medium">Model</span>
              <Input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                maxLength={60}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium">Year</span>
              <Input
                inputMode="numeric"
                value={year}
                onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder="2024"
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium">Registration No (optional)</span>
              <Input
                value={registrationNo}
                onChange={(e) => setRegistrationNo(e.target.value.toUpperCase())}
                maxLength={40}
                placeholder="TN 09 AB 1234"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium">
                Fuel type{" "}
                <span className="font-normal text-muted-foreground">(optional)</span>
              </span>
              <select
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={fuelType}
                onChange={(e) =>
                  setFuelType(e.target.value as VehicleFuelType | "")
                }
              >
                <option value="">— pick a fuel —</option>
                {FUEL_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-[10px] text-muted-foreground">
                Drives the unit on fuel-fill inputs (litres / kWh / kg) and
                enables mileage tracking.
              </span>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium">Purchase date</span>
              <DateInput
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium">Purchase price</span>
              <AmountInput value={purchasePrice} onChange={setPurchasePrice} placeholder="0" />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium">
              Odometer at purchase{" "}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </span>
            <Input
              inputMode="numeric"
              value={odometerStart}
              onChange={(e) => setOdometerStart(e.target.value.replace(/\D/g, ""))}
              placeholder="km"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium">Notes</span>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting || !name.trim() || !ownerContactId}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

