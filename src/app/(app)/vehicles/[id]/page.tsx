"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useMemo, useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import {
  ArrowLeft,
  Fuel,
  Wrench,
  ShoppingCart,
  Pencil,
  Trash2,
  PackageX,
  Plus,
} from "lucide-react";
import { AttachmentList } from "@/components/attachments/attachment-list";
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
import { formatINR, formatDate } from "@/lib/utils";

type Insurance = {
  id: string;
  name: string;
  institution: string | null;
  policyNumber: string | null;
  insuranceStatus: string | null;
  premiumAmount: number | null;
  premiumFrequency: string | null;
  nextDueDate: string | null;
};

type Loan = {
  id: string;
  kind: string;
  lender: string;
  principal: number;
  outstanding: number;
  nextDueDate: string | null;
  active: boolean;
};

type Claim = {
  id: string;
  claimNumber: string | null;
  status: string;
  incidentDate: string;
  claimedAmount: number | null;
  receivedAmount: number | null;
};

type Txn = {
  id: string;
  type: string;
  amount: number;
  date: string;
  description: string;
  categoryId: string | null;
  category: { id: string; name: string } | null;
};

type Vehicle = {
  id: string;
  kind: string;
  name: string;
  make: string | null;
  model: string | null;
  year: number | null;
  registrationNo: string | null;
  purchaseDate: string | null;
  purchasePrice: number | null;
  odometerStart: number | null;
  active: boolean;
  notes: string | null;
  ownerContact: { id: string; name: string };
  disposedAt: string | null;
  disposalKind:
    | "SOLD"
    | "EXCHANGED"
    | "SCRAPPED"
    | "GIFTED"
    | "TOTAL_LOSS"
    | null;
  disposalAmount: number | null;
  disposalContact: { id: string; name: string } | null;
  replacedBy: { id: string; name: string; registrationNo: string | null } | null;
  replaces: { id: string; name: string; registrationNo: string | null }[];
  insurances: Insurance[];
  loans: Loan[];
  claims: Claim[];
  transactions: Txn[];
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function VehicleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [disposeOpen, setDisposeOpen] = useState(false);
  const { data, isLoading } = useSWR<{ vehicle: Vehicle }>(
    `/api/vehicles/${id}`,
    fetcher,
  );
  const vehicle = data?.vehicle;

  const totals = useMemo(() => {
    if (!vehicle) return { purchase: 0, service: 0, fuel: 0, total: 0 };
    let purchase = 0,
      service = 0,
      fuel = 0;
    for (const t of vehicle.transactions) {
      const name = t.category?.name?.toLowerCase() ?? "";
      if (name === "vehicle purchase") purchase += t.amount;
      else if (name === "vehicle service") service += t.amount;
      else if (name === "fuel") fuel += t.amount;
    }
    return {
      purchase,
      service,
      fuel,
      total: purchase + service + fuel,
    };
  }, [vehicle]);

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!vehicle)
    return (
      <p className="text-sm text-muted-foreground">
        Vehicle not found.{" "}
        <Link href="/vehicles" className="underline">
          Back to vehicles
        </Link>
      </p>
    );

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/vehicles"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> All vehicles
        </Link>
        <div className="mt-1 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-tight truncate">
              {vehicle.name}
            </h1>
            <p className="text-sm text-muted-foreground">
              {vehicle.kind} ·{" "}
              {[vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(" ") ||
                "—"}
              {vehicle.registrationNo ? ` · ${vehicle.registrationNo}` : ""}
            </p>
            <p className="text-xs text-muted-foreground">
              Owner: {vehicle.ownerContact.name}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditOpen(true)}
              className="gap-1"
            >
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDisposeOpen(true)}
              className="gap-1"
              disabled={!!vehicle.disposedAt}
              title={
                vehicle.disposedAt
                  ? "Already disposed"
                  : "Mark as sold / exchanged"
              }
            >
              <PackageX className="h-3.5 w-3.5" /> Dispose
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => deleteVehicle(id, vehicle.name, router)}
              title="Delete vehicle"
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        </div>
      </div>

      {vehicle.disposedAt && (
        <DisposedBanner vehicle={vehicle} />
      )}

      {/* Running cost summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Purchase"
          value={formatINR(totals.purchase || vehicle.purchasePrice || 0)}
          icon={<ShoppingCart className="h-3.5 w-3.5" />}
        />
        <StatCard
          label="Service"
          value={formatINR(totals.service)}
          icon={<Wrench className="h-3.5 w-3.5" />}
        />
        <StatCard
          label="Fuel"
          value={formatINR(totals.fuel)}
          icon={<Fuel className="h-3.5 w-3.5" />}
        />
        <StatCard label="Service + Fuel" value={formatINR(totals.service + totals.fuel)} />
      </div>

      {/* Documents (RC / FC / PUC / Road tax / Insurance copy / Other) */}
      <DocumentsSection vehicleId={id} />

      {/* Linked insurance */}
      <Section title={`Insurance (${vehicle.insurances.length})`}>
        {vehicle.insurances.length === 0 ? (
          <Empty msg="No vehicle insurance linked yet. Add a VEHICLE policy on /insurance and link it to this vehicle." />
        ) : (
          <div className="rounded-lg border bg-card divide-y">
            {vehicle.insurances.map((p) => (
              <Link
                key={p.id}
                href={`/insurance/${p.id}`}
                className="flex items-start justify-between gap-3 p-3 text-sm hover:bg-muted/40"
              >
                <div>
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {p.institution ?? "—"}
                    {p.policyNumber ? ` · ${p.policyNumber}` : ""}
                  </div>
                </div>
                <div className="text-right">
                  {p.premiumAmount != null && (
                    <div className="font-medium">
                      {formatINR(p.premiumAmount)}
                      <span className="text-xs text-muted-foreground">
                        {p.premiumFrequency
                          ? ` · ${p.premiumFrequency.toLowerCase()}`
                          : ""}
                      </span>
                    </div>
                  )}
                  {p.nextDueDate && (
                    <div className="text-xs text-muted-foreground">
                      Due {formatDate(p.nextDueDate)}
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </Section>

      {/* Linked loans */}
      <Section title={`Loans (${vehicle.loans.length})`}>
        {vehicle.loans.length === 0 ? (
          <Empty msg="No loan linked to this vehicle." />
        ) : (
          <div className="rounded-lg border bg-card divide-y">
            {vehicle.loans.map((l) => (
              <div key={l.id} className="flex items-start justify-between gap-3 p-3 text-sm">
                <div>
                  <div className="font-medium">{l.lender}</div>
                  <div className="text-xs text-muted-foreground">{l.kind}</div>
                </div>
                <div className="text-right">
                  <div className="font-medium">{formatINR(l.outstanding)}</div>
                  <div className="text-xs text-muted-foreground">
                    of {formatINR(l.principal)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Claims */}
      <Section title={`Claims (${vehicle.claims.length})`}>
        {vehicle.claims.length === 0 ? (
          <Empty msg="No vehicle claims filed." />
        ) : (
          <div className="rounded-lg border bg-card divide-y">
            {vehicle.claims.map((c) => (
              <div key={c.id} className="flex items-start justify-between gap-3 p-3 text-sm">
                <div>
                  <div className="font-medium">
                    {c.claimNumber ?? `Incident ${formatDate(c.incidentDate)}`}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {c.status.replace("_", " ")}
                  </div>
                </div>
                <div className="text-right">
                  {c.claimedAmount != null && (
                    <div className="text-xs text-muted-foreground">
                      Claimed {formatINR(c.claimedAmount)}
                    </div>
                  )}
                  {c.receivedAmount != null && (
                    <div className="font-medium">{formatINR(c.receivedAmount)}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Transactions */}
      <Section title={`Transactions (${vehicle.transactions.length})`}>
        {vehicle.transactions.length === 0 ? (
          <Empty msg="No transactions tagged to this vehicle yet. When you log a Vehicle Purchase / Vehicle Service / Fuel expense, pick this vehicle to attribute it here." />
        ) : (
          <div className="rounded-lg border bg-card divide-y">
            {vehicle.transactions.map((t) => (
              <div key={t.id} className="flex items-start justify-between gap-3 p-3 text-sm">
                <div>
                  <div>{t.description}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatDate(t.date)}
                    {t.category ? ` · ${t.category.name}` : ""}
                  </div>
                </div>
                <div className="font-medium">{formatINR(t.amount)}</div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <EditVehicleDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        vehicle={vehicle}
      />
      <DisposeVehicleDialog
        open={disposeOpen}
        onClose={() => setDisposeOpen(false)}
        vehicle={vehicle}
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-base font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <h2 className="text-sm font-medium">{title}</h2>
      {children}
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return (
    <div className="rounded-lg border bg-card p-4 text-xs text-muted-foreground">
      {msg}
    </div>
  );
}

/* ---------------- Delete helper ---------------- */

async function deleteVehicle(
  id: string,
  name: string,
  router: ReturnType<typeof useRouter>,
) {
  if (
    !confirm(
      `Delete "${name}"? Any linked transactions, insurance policies, and loans will be unlinked but kept. This cannot be undone.`,
    )
  )
    return;
  const res = await fetch(`/api/vehicles/${id}`, { method: "DELETE" });
  if (res.ok) {
    globalMutate("/api/vehicles");
    router.push("/vehicles");
  } else {
    const body = await res.json().catch(() => ({}));
    alert(body.error ?? "Failed to delete vehicle");
  }
}

/* ---------------- Edit vehicle dialog ---------------- */

type VehicleKind = "BIKE" | "CAR" | "TRACTOR" | "TRUCK" | "SCOOTER" | "OTHER";

const VEHICLE_KIND_OPTIONS: { value: VehicleKind; label: string }[] = [
  { value: "CAR", label: "Car" },
  { value: "BIKE", label: "Bike" },
  { value: "SCOOTER", label: "Scooter" },
  { value: "TRACTOR", label: "Tractor" },
  { value: "TRUCK", label: "Truck" },
  { value: "OTHER", label: "Other" },
];

function EditVehicleDialog({
  open,
  onClose,
  vehicle,
}: {
  open: boolean;
  onClose: () => void;
  vehicle: Vehicle;
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
  const [purchaseDate, setPurchaseDate] = useState("");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [odometerStart, setOdometerStart] = useState("");
  const [active, setActive] = useState(true);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- prefill from server data on open */
    setKind(vehicle.kind as VehicleKind);
    setName(vehicle.name);
    setOwnerContactId(vehicle.ownerContact.id);
    setMake(vehicle.make ?? "");
    setModel(vehicle.model ?? "");
    setYear(vehicle.year != null ? String(vehicle.year) : "");
    setRegistrationNo(vehicle.registrationNo ?? "");
    setPurchaseDate(vehicle.purchaseDate ? vehicle.purchaseDate.slice(0, 10) : "");
    setPurchasePrice(
      vehicle.purchasePrice != null ? String(vehicle.purchasePrice) : "",
    );
    setOdometerStart(
      vehicle.odometerStart != null ? String(vehicle.odometerStart) : "",
    );
    setActive(vehicle.active);
    setNotes(vehicle.notes ?? "");
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, vehicle]);

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
        purchaseDate: purchaseDate || undefined,
        purchasePrice: purchasePrice ? Number(purchasePrice) : undefined,
        odometerStart: odometerStart ? Number(odometerStart) : undefined,
        notes: notes.trim() || undefined,
        active,
      };
      const res = await fetch(`/api/vehicles/${vehicle.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Failed");
        return;
      }
      globalMutate(`/api/vehicles/${vehicle.id}`);
      globalMutate("/api/vehicles");
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit vehicle</DialogTitle>
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
                {VEHICLE_KIND_OPTIONS.map((k) => (
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
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium">Name</span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
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
                onChange={(e) =>
                  setYear(e.target.value.replace(/\D/g, "").slice(0, 4))
                }
              />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium">Registration No</span>
            <Input
              value={registrationNo}
              onChange={(e) => setRegistrationNo(e.target.value.toUpperCase())}
              maxLength={40}
            />
          </label>
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
              <AmountInput
                value={purchasePrice}
                onChange={setPurchasePrice}
                placeholder="0"
              />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium">Odometer at purchase</span>
            <Input
              inputMode="numeric"
              value={odometerStart}
              onChange={(e) => setOdometerStart(e.target.value.replace(/\D/g, ""))}
              placeholder="km"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            <span>Active (uncheck to archive without deleting)</span>
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
          <Button
            onClick={submit}
            disabled={submitting || !name.trim() || !ownerContactId}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- Disposed banner ---------------- */

const DISPOSAL_LABEL: Record<string, string> = {
  SOLD: "Sold",
  EXCHANGED: "Exchanged",
  SCRAPPED: "Scrapped",
  GIFTED: "Gifted",
  TOTAL_LOSS: "Total loss",
};

function DisposedBanner({ vehicle }: { vehicle: Vehicle }) {
  const kind = vehicle.disposalKind ?? "SOLD";
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50/50 p-4 dark:border-amber-700 dark:bg-amber-950/20">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
            {DISPOSAL_LABEL[kind]} ·{" "}
            {vehicle.disposedAt ? formatDate(vehicle.disposedAt) : "—"}
          </div>
          <div className="mt-1 text-sm">
            {vehicle.disposalContact && (
              <>
                {kind === "GIFTED" ? "Gifted to " : "To "}
                <Link
                  href={`/contacts/${vehicle.disposalContact.id}`}
                  className="font-medium underline"
                >
                  {vehicle.disposalContact.name}
                </Link>
              </>
            )}
            {vehicle.disposalAmount != null && vehicle.disposalAmount > 0 && (
              <span className="ml-2 text-muted-foreground">
                for {formatINR(vehicle.disposalAmount)}
              </span>
            )}
            {vehicle.replacedBy && (
              <div className="mt-1">
                Replaced by{" "}
                <Link
                  href={`/vehicles/${vehicle.replacedBy.id}`}
                  className="font-medium underline"
                >
                  {vehicle.replacedBy.name}
                  {vehicle.replacedBy.registrationNo
                    ? ` · ${vehicle.replacedBy.registrationNo}`
                    : ""}
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Dispose dialog ---------------- */

type DisposalKind = "SOLD" | "EXCHANGED" | "SCRAPPED" | "GIFTED" | "TOTAL_LOSS";

function DisposeVehicleDialog({
  open,
  onClose,
  vehicle,
}: {
  open: boolean;
  onClose: () => void;
  vehicle: Vehicle;
}) {
  const router = useRouter();
  const { data: contactsData } = useSWR<{ members: { id: string; name: string }[] }>(
    open ? "/api/contacts" : null,
    fetcher,
  );
  const contacts = contactsData?.members ?? [];
  const { data: vehiclesData } = useSWR<{
    vehicles: {
      id: string;
      name: string;
      registrationNo: string | null;
      disposedAt: string | null;
    }[];
  }>(open ? "/api/vehicles" : null, fetcher);
  const otherVehicles = (vehiclesData?.vehicles ?? []).filter(
    (v) => v.id !== vehicle.id && !v.disposedAt,
  );

  const { data: accountsData } = useSWR<{
    accounts: { id: string; name: string; kind: string }[];
  }>(open ? "/api/accounts" : null, fetcher);
  const accounts = (accountsData?.accounts ?? []).filter((a) => a.kind !== "CARD");

  const [kind, setKind] = useState<DisposalKind>("SOLD");
  const [date, setDate] = useState("");
  const [amount, setAmount] = useState("");
  const [buyerContactId, setBuyerContactId] = useState("");
  const [replacedById, setReplacedById] = useState("");
  const [accountId, setAccountId] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- reset form on dialog open */
    setKind("SOLD");
    setDate(new Date().toISOString().slice(0, 10));
    setAmount("");
    setBuyerContactId("");
    setReplacedById("");
    setAccountId("");
    setNotes("");
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open]);

  const openLoan = vehicle.loans.find((l) => l.active && l.outstanding > 0);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        kind,
        date,
        amount: amount ? Number(amount) : undefined,
        buyerContactId: buyerContactId || undefined,
        replacedById: kind === "EXCHANGED" && replacedById ? replacedById : undefined,
        accountId: amount && accountId ? accountId : undefined,
        notes: notes.trim() || undefined,
      };
      const res = await fetch(`/api/vehicles/${vehicle.id}/dispose`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Failed");
        return;
      }
      globalMutate(`/api/vehicles/${vehicle.id}`);
      globalMutate("/api/vehicles");
      onClose();
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  const showBuyer = kind === "SOLD" || kind === "GIFTED";
  const showAmount = kind === "SOLD" || kind === "EXCHANGED" || kind === "SCRAPPED" || kind === "TOTAL_LOSS";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Dispose vehicle</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {openLoan && (
            <div className="rounded-md border border-amber-300 bg-amber-50/40 p-3 text-xs dark:border-amber-700 dark:bg-amber-950/20">
              <div className="font-medium">Open loan reminder</div>
              <div className="mt-0.5 text-muted-foreground">
                This vehicle has an active loan with {formatINR(openLoan.outstanding)}{" "}
                outstanding. Settle or transfer it separately —{" "}
                <Link href={`/loans/${openLoan.id}`} className="underline">
                  open loan
                </Link>
                .
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium">What happened?</span>
              <select
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={kind}
                onChange={(e) => setKind(e.target.value as DisposalKind)}
              >
                <option value="SOLD">Sold to someone</option>
                <option value="EXCHANGED">Exchanged for another vehicle</option>
                <option value="GIFTED">Gifted</option>
                <option value="SCRAPPED">Scrapped</option>
                <option value="TOTAL_LOSS">Total loss (insurance claim)</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium">Date</span>
              <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
          </div>

          {showBuyer && (
            <label className="block">
              <span className="text-xs font-medium">
                {kind === "GIFTED" ? "Recipient" : "Buyer"}
              </span>
              <select
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={buyerContactId}
                onChange={(e) => setBuyerContactId(e.target.value)}
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
                    Add one
                  </Link>
                  .
                </p>
              )}
            </label>
          )}

          {kind === "EXCHANGED" && (
            <label className="block">
              <span className="text-xs font-medium">Replacement vehicle</span>
              <select
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={replacedById}
                onChange={(e) => setReplacedById(e.target.value)}
              >
                <option value="">Select vehicle…</option>
                {otherVehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                    {v.registrationNo ? ` · ${v.registrationNo}` : ""}
                  </option>
                ))}
              </select>
              {otherVehicles.length === 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  No other active vehicles.{" "}
                  <Link href="/vehicles" className="underline">
                    Add the new one first
                  </Link>
                  , then come back.
                </p>
              )}
            </label>
          )}

          {showAmount && (
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-medium">
                  {kind === "TOTAL_LOSS"
                    ? "Insurance payout"
                    : kind === "SCRAPPED"
                      ? "Scrap value"
                      : kind === "EXCHANGED"
                        ? "Top-up received"
                        : "Sale amount"}
                </span>
                <AmountInput value={amount} onChange={setAmount} placeholder="0" />
              </label>
              <label className="block">
                <span className="text-xs font-medium">
                  Credit to{" "}
                  <span className="font-normal text-muted-foreground">(optional)</span>
                </span>
                <select
                  className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                >
                  <option value="">— no transaction —</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.kind.toLowerCase()})
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          <label className="block">
            <span className="text-xs font-medium">Notes</span>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
          </label>

          <p className="text-[11px] text-muted-foreground">
            The vehicle will be archived. Linked insurance policies stay on file —
            cancel or transfer them separately on{" "}
            <Link href="/insurance" className="underline">
              /insurance
            </Link>
            .
          </p>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={
              submitting ||
              !date ||
              (kind === "EXCHANGED" && !replacedById)
            }
          >
            {kind === "EXCHANGED"
              ? "Mark as exchanged"
              : kind === "GIFTED"
                ? "Mark as gifted"
                : kind === "SCRAPPED"
                  ? "Mark as scrapped"
                  : kind === "TOTAL_LOSS"
                    ? "Mark as total loss"
                    : "Mark as sold"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- Documents (RC / FC / PUC / Road Tax / Insurance copy) ---------------- */

type VehicleDocumentKind =
  | "RC"
  | "FC"
  | "PUC"
  | "ROAD_TAX"
  | "INSURANCE_COPY"
  | "OTHER";

type VehicleDocument = {
  id: string;
  kind: VehicleDocumentKind;
  label: string | null;
  number: string | null;
  issuedAt: string | null;
  expiryAt: string | null;
  notes: string | null;
};

const DOC_KIND_LABEL: Record<VehicleDocumentKind, string> = {
  RC: "RC book",
  FC: "Fitness Certificate",
  PUC: "Pollution (PUC)",
  ROAD_TAX: "Road tax",
  INSURANCE_COPY: "Insurance copy",
  OTHER: "Other",
};

const DOC_KIND_OPTIONS: { value: VehicleDocumentKind; label: string }[] = [
  { value: "RC", label: DOC_KIND_LABEL.RC },
  { value: "FC", label: DOC_KIND_LABEL.FC },
  { value: "PUC", label: DOC_KIND_LABEL.PUC },
  { value: "ROAD_TAX", label: DOC_KIND_LABEL.ROAD_TAX },
  { value: "INSURANCE_COPY", label: DOC_KIND_LABEL.INSURANCE_COPY },
  { value: "OTHER", label: DOC_KIND_LABEL.OTHER },
];

function expiryTone(
  expiryAt: string | null,
): { label: string; cls: string } | null {
  if (!expiryAt) return null;
  const due = new Date(expiryAt);
  due.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) {
    return {
      label: `Expired ${Math.abs(days)} day${days === -1 ? "" : "s"} ago`,
      cls: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300",
    };
  }
  if (days === 0) {
    return {
      label: "Expires today",
      cls: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300",
    };
  }
  if (days <= 7) {
    return {
      label: `${days} day${days === 1 ? "" : "s"} left`,
      cls: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300",
    };
  }
  if (days <= 30) {
    return {
      label: `${days} days left`,
      cls: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
    };
  }
  return {
    label: `${days} days left`,
    cls: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  };
}

function DocumentsSection({ vehicleId }: { vehicleId: string }) {
  const docsKey = `/api/vehicles/${vehicleId}/documents`;
  const { data } = useSWR<{ documents: VehicleDocument[] }>(docsKey, fetcher);
  const docs = data?.documents ?? [];
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<VehicleDocument | null>(null);

  return (
    <Section
      title={
        <span className="flex items-center justify-between gap-2">
          <span>Documents ({docs.length})</span>
          <Button
            size="sm"
            variant="outline"
            className="gap-1"
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus className="h-3.5 w-3.5" /> Add document
          </Button>
        </span>
      }
    >
      {docs.length === 0 ? (
        <Empty msg="No documents yet. Add RC, FC, PUC, road-tax, or insurance copies with expiry dates — you'll get reminders before each renewal." />
      ) : (
        <div className="rounded-lg border bg-card divide-y">
          {docs.map((d) => {
            const tone = expiryTone(d.expiryAt);
            return (
              <div key={d.id} className="p-3 text-sm space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">
                      {DOC_KIND_LABEL[d.kind]}
                      {d.label ? ` · ${d.label}` : ""}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {d.number ? `#${d.number} · ` : ""}
                      {d.issuedAt ? `Issued ${formatDate(d.issuedAt)}` : ""}
                      {d.expiryAt
                        ? `${d.issuedAt ? " · " : ""}Expires ${formatDate(d.expiryAt)}`
                        : ""}
                    </div>
                    {d.notes && (
                      <div className="mt-1 text-xs text-muted-foreground line-clamp-2">
                        {d.notes}
                      </div>
                    )}
                  </div>
                  <div className="flex items-start gap-2 shrink-0">
                    {tone && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${tone.cls}`}
                      >
                        {tone.label}
                      </span>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setEditing(d);
                        setOpen(true);
                      }}
                      title="Edit"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteDocument(vehicleId, d.id, docsKey)}
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
                <AttachmentList
                  ownerKind="VEHICLE_DOCUMENT"
                  ownerId={d.id}
                  emptyMessage="No files attached. RC front, RC back, PUC scan, etc."
                />
              </div>
            );
          })}
        </div>
      )}
      <DocumentDialog
        open={open}
        onClose={() => setOpen(false)}
        vehicleId={vehicleId}
        doc={editing}
      />
    </Section>
  );
}

async function deleteDocument(
  vehicleId: string,
  docId: string,
  swrKey: string,
) {
  if (
    !confirm(
      "Delete this document? Linked files will be archived and the renewal reminder removed.",
    )
  ) {
    return;
  }
  const res = await fetch(
    `/api/vehicles/${vehicleId}/documents/${docId}`,
    { method: "DELETE" },
  );
  if (res.ok) {
    globalMutate(swrKey);
  } else {
    const body = await res.json().catch(() => ({}));
    alert(body.error ?? "Failed to delete document");
  }
}

function DocumentDialog({
  open,
  onClose,
  vehicleId,
  doc,
}: {
  open: boolean;
  onClose: () => void;
  vehicleId: string;
  doc: VehicleDocument | null;
}) {
  const editing = !!doc;
  const [kind, setKind] = useState<VehicleDocumentKind>("RC");
  const [label, setLabel] = useState("");
  const [number, setNumber] = useState("");
  const [issuedAt, setIssuedAt] = useState("");
  const [expiryAt, setExpiryAt] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- prefill on open */
    setKind(doc?.kind ?? "RC");
    setLabel(doc?.label ?? "");
    setNumber(doc?.number ?? "");
    setIssuedAt(doc?.issuedAt ? doc.issuedAt.slice(0, 10) : "");
    setExpiryAt(doc?.expiryAt ? doc.expiryAt.slice(0, 10) : "");
    setNotes(doc?.notes ?? "");
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, doc]);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        kind,
        label: label.trim() || null,
        number: number.trim() || null,
        issuedAt: issuedAt || null,
        expiryAt: expiryAt || null,
        notes: notes.trim() || null,
      };

      const url = editing
        ? `/api/vehicles/${vehicleId}/documents/${doc!.id}`
        : `/api/vehicles/${vehicleId}/documents`;
      const res = await fetch(url, {
        method: editing ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Failed to save");
        return;
      }
      globalMutate(`/api/vehicles/${vehicleId}/documents`);
      globalMutate(`/api/vehicles/${vehicleId}`);
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit document" : "Add document"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium">Type</span>
              <select
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={kind}
                onChange={(e) =>
                  setKind(e.target.value as VehicleDocumentKind)
                }
              >
                {DOC_KIND_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium">Document #</span>
              <Input
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                maxLength={80}
                placeholder="As printed"
              />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium">
              Label{" "}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </span>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={80}
              placeholder="e.g. New RTO card, PUC Bangalore"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium">Issued on</span>
              <DateInput
                value={issuedAt}
                onChange={(e) => setIssuedAt(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium">Expires on</span>
              <DateInput
                value={expiryAt}
                onChange={(e) => setExpiryAt(e.target.value)}
              />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium">Notes</span>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={500}
            />
          </label>
          <p className="text-[10px] text-muted-foreground">
            Save the document first, then upload files (RC front + back, PUC scan,
            etc.) from the row on the previous screen.
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {editing ? "Save" : "Add document"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
