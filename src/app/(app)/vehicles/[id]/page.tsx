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
  FileText,
  Gauge,
  Wallet,
  ShieldCheck,
  Landmark,
  Activity,
  ArrowRight,
} from "lucide-react";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Bar,
  BarChart,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
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
  category: {
    id: string;
    name: string;
    parent: { id: string; name: string } | null;
  } | null;
};

type Vehicle = {
  id: string;
  kind: string;
  name: string;
  make: string | null;
  model: string | null;
  year: number | null;
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

  const purchaseAmount = totals.purchase || vehicle.purchasePrice || 0;
  const totalSpend = purchaseAmount + totals.service + totals.fuel;
  const activeInsurance = vehicle.insurances.length;
  const activeLoan = vehicle.loans.filter((l) => l.active).length;
  const openClaims = vehicle.claims.filter(
    (c) => !["PAID", "CLOSED", "REJECTED"].includes(c.status),
  ).length;

  return (
    <div className="space-y-6">
      {/* Sticky page header — primary identifiers + action buttons. */}
      <div className="sticky top-0 z-20 -mx-4 sm:-mx-6 lg:-mx-8 border-b bg-background/95 px-4 py-3 backdrop-blur-sm sm:px-6 lg:px-8">
        <Link
          href="/vehicles"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> All vehicles
        </Link>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight truncate">
                {vehicle.name}
              </h1>
              <Badge tone="default">{vehicle.kind}</Badge>
              {vehicle.fuelType && (
                <Badge tone="fuel">{vehicle.fuelType}</Badge>
              )}
              {!vehicle.active && <Badge tone="muted">Archived</Badge>}
              {vehicle.disposedAt && (
                <Badge tone="warn">Disposed · {vehicle.disposalKind}</Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {[vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(" ") ||
                "—"}
              {vehicle.registrationNo ? ` · ${vehicle.registrationNo}` : ""}
              {` · Owner: ${vehicle.ownerContact.name}`}
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

      {vehicle.disposedAt && <DisposedBanner vehicle={vehicle} />}

      {/* Always-visible KPI strip — the four numbers we want at-a-glance
          regardless of which tab the user is on. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiTile
          label="Total spend"
          value={formatINR(totalSpend)}
          hint="Purchase + service + fuel"
          icon={<Wallet className="h-4 w-4" />}
          tone="primary"
        />
        <KpiTile
          label="Purchase price"
          value={formatINR(purchaseAmount)}
          hint={
            vehicle.purchaseDate ? formatDate(vehicle.purchaseDate) : undefined
          }
          icon={<ShoppingCart className="h-4 w-4" />}
        />
        <FuelKpiTile vehicleId={id} />
        <KpiTile
          label="Status"
          value={statusLabel(vehicle)}
          hint={statusHint({ activeInsurance, activeLoan, openClaims })}
          icon={<Activity className="h-4 w-4" />}
        />
      </div>

      <Tabs defaultValue="overview" className="gap-4">
        <TabsList variant="line" className="overflow-x-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="fuel">Fuel &amp; Mileage</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="insurance">
            Insurance{vehicle.insurances.length ? ` (${vehicle.insurances.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="loans">
            Loans{vehicle.loans.length ? ` (${vehicle.loans.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="claims">
            Claims{vehicle.claims.length ? ` (${vehicle.claims.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="transactions">
            Transactions{vehicle.transactions.length ? ` (${vehicle.transactions.length})` : ""}
          </TabsTrigger>
        </TabsList>

        {/* ─── Overview ──────────────────────────────────────────────── */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
            <CostMixCard
              purchase={purchaseAmount}
              service={totals.service}
              fuel={totals.fuel}
            />
            <div className="space-y-3">
              <SnapshotRow
                icon={<ShieldCheck className="h-4 w-4 text-emerald-600" />}
                label="Insurance"
                value={
                  activeInsurance > 0
                    ? `${activeInsurance} active`
                    : "None linked"
                }
                href={
                  vehicle.insurances[0]
                    ? `/insurance/${vehicle.insurances[0].id}`
                    : "/insurance"
                }
              />
              <SnapshotRow
                icon={<Landmark className="h-4 w-4 text-sky-600" />}
                label="Loans"
                value={
                  activeLoan > 0
                    ? `${activeLoan} active · ${formatINR(
                        vehicle.loans.reduce((s, l) => s + l.outstanding, 0),
                      )} outstanding`
                    : "None"
                }
                href={vehicle.loans[0] ? `/loans/${vehicle.loans[0].id}` : "/loans/bank"}
              />
              <SnapshotRow
                icon={<Activity className="h-4 w-4 text-amber-600" />}
                label="Open claims"
                value={openClaims > 0 ? `${openClaims} open` : "None"}
              />
              <SnapshotRow
                icon={<Wrench className="h-4 w-4 text-violet-600" />}
                label="Service spend"
                value={formatINR(totals.service)}
              />
              <SnapshotRow
                icon={<Fuel className="h-4 w-4 text-orange-600" />}
                label="Fuel spend"
                value={formatINR(totals.fuel)}
              />
            </div>
          </div>

          <Section
            title={
              <span className="flex items-center justify-between">
                <span>Recent activity</span>
                {vehicle.transactions.length > 5 && (
                  <span className="text-[10px] font-normal text-muted-foreground uppercase tracking-wide">
                    Showing 5 of {vehicle.transactions.length}
                  </span>
                )}
              </span>
            }
          >
            {vehicle.transactions.length === 0 ? (
              <Empty msg="No transactions tagged yet. Log a Vehicle Purchase / Service / Fuel expense and pick this vehicle to attribute it here." />
            ) : (
              <div className="rounded-xl border bg-card divide-y">
                {vehicle.transactions.slice(0, 5).map((t) => (
                  <TransactionRow key={t.id} t={t} />
                ))}
              </div>
            )}
          </Section>
        </TabsContent>

        {/* ─── Fuel & Mileage ─────────────────────────────────────────── */}
        <TabsContent value="fuel" className="space-y-4">
          <FuelMileageSection vehicleId={id} />
        </TabsContent>

        {/* ─── Documents ──────────────────────────────────────────────── */}
        <TabsContent value="documents" className="space-y-4">
          <DocumentsSection vehicleId={id} />
        </TabsContent>

        {/* ─── Insurance ──────────────────────────────────────────────── */}
        <TabsContent value="insurance" className="space-y-4">
          {vehicle.insurances.length === 0 ? (
            <Empty msg="No vehicle insurance linked yet. Add a VEHICLE policy on /insurance and link it to this vehicle." />
          ) : (
            <div className="rounded-xl border bg-card divide-y">
              {vehicle.insurances.map((p) => (
                <Link
                  key={p.id}
                  href={`/insurance/${p.id}`}
                  className="flex items-start justify-between gap-3 p-4 text-sm hover:bg-muted/40 transition-colors"
                >
                  <div>
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {p.institution ?? "—"}
                      {p.policyNumber ? ` · ${p.policyNumber}` : ""}
                    </div>
                    {p.insuranceStatus && (
                      <div className="mt-1 inline-flex items-center rounded-full bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                        {p.insuranceStatus}
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    {p.premiumAmount != null && (
                      <div className="font-medium tabular-nums">
                        {formatINR(p.premiumAmount)}
                        <span className="text-xs text-muted-foreground">
                          {p.premiumFrequency ? ` · ${p.premiumFrequency.toLowerCase()}` : ""}
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
        </TabsContent>

        {/* ─── Loans ──────────────────────────────────────────────────── */}
        <TabsContent value="loans" className="space-y-4">
          {vehicle.loans.length === 0 ? (
            <Empty msg="No loan linked to this vehicle." />
          ) : (
            <div className="rounded-xl border bg-card divide-y">
              {vehicle.loans.map((l) => {
                const pct =
                  l.principal > 0
                    ? Math.max(
                        0,
                        Math.min(
                          100,
                          ((l.principal - l.outstanding) / l.principal) * 100,
                        ),
                      )
                    : 0;
                return (
                  <div key={l.id} className="p-4 text-sm space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium">{l.lender}</div>
                        <div className="text-xs text-muted-foreground">
                          {l.kind}
                          {l.nextDueDate ? ` · next due ${formatDate(l.nextDueDate)}` : ""}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-medium tabular-nums">
                          {formatINR(l.outstanding)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          of {formatINR(l.principal)} · {Math.round(pct)}% paid
                        </div>
                      </div>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full bg-emerald-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ─── Claims ─────────────────────────────────────────────────── */}
        <TabsContent value="claims" className="space-y-4">
          {vehicle.claims.length === 0 ? (
            <Empty msg="No vehicle claims filed." />
          ) : (
            <div className="rounded-xl border bg-card divide-y">
              {vehicle.claims.map((c) => (
                <div
                  key={c.id}
                  className="flex items-start justify-between gap-3 p-4 text-sm"
                >
                  <div>
                    <div className="font-medium">
                      {c.claimNumber ?? `Incident ${formatDate(c.incidentDate)}`}
                    </div>
                    <div className="mt-1 inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                      {c.status.replace(/_/g, " ")}
                    </div>
                  </div>
                  <div className="text-right tabular-nums">
                    {c.claimedAmount != null && (
                      <div className="text-xs text-muted-foreground">
                        Claimed {formatINR(c.claimedAmount)}
                      </div>
                    )}
                    {c.receivedAmount != null && (
                      <div className="font-medium">
                        Received {formatINR(c.receivedAmount)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ─── All Transactions ───────────────────────────────────────── */}
        <TabsContent value="transactions" className="space-y-4">
          {vehicle.transactions.length === 0 ? (
            <Empty msg="No transactions tagged to this vehicle yet. When you log a Vehicle Purchase / Vehicle Service / Fuel expense, pick this vehicle to attribute it here." />
          ) : (
            <div className="rounded-xl border bg-card divide-y">
              {vehicle.transactions.map((t) => (
                <TransactionRow key={t.id} t={t} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

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

/* ---------------- Tile + small UI primitives ---------------- */

function Badge({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: "default" | "muted" | "warn" | "fuel";
}) {
  const cls =
    tone === "muted"
      ? "bg-muted text-muted-foreground"
      : tone === "warn"
        ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
        : tone === "fuel"
          ? "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300"
          : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${cls}`}
    >
      {children}
    </span>
  );
}

function KpiTile({
  label,
  value,
  hint,
  icon,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: React.ReactNode;
  tone?: "default" | "primary";
}) {
  const accent =
    tone === "primary"
      ? "border-primary/30 bg-primary/5"
      : "border-border bg-card";
  return (
    <div className={`rounded-xl border ${accent} p-4`}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1.5 text-xl font-semibold tabular-nums">{value}</div>
      {hint && (
        <div className="mt-0.5 text-[11px] text-muted-foreground truncate">
          {hint}
        </div>
      )}
    </div>
  );
}

function FuelKpiTile({ vehicleId }: { vehicleId: string }) {
  const { data } = useSWR<FuelSummary>(
    `/api/vehicles/${vehicleId}/fuel-summary`,
    fetcher,
  );
  const mileage = data?.averageMileage;
  const km = data?.kmDriven;
  const unit = data?.totals?.unit ?? "L";
  return (
    <KpiTile
      label="Mileage"
      value={mileage != null ? `${mileage.toFixed(1)}` : "—"}
      hint={
        mileage != null
          ? `km/${unit} · ${km != null ? km.toLocaleString() + " km driven" : "drive log"}`
          : km != null
            ? `${km.toLocaleString()} km driven`
            : "Add fuel fills with odometer"
      }
      icon={<Gauge className="h-4 w-4" />}
    />
  );
}

function statusLabel(v: {
  active: boolean;
  disposedAt: string | null;
  disposalKind: string | null;
}): string {
  if (v.disposedAt) {
    return v.disposalKind
      ? v.disposalKind.replace(/_/g, " ").toLowerCase()
      : "Disposed";
  }
  return v.active ? "Active" : "Archived";
}

function statusHint(args: {
  activeInsurance: number;
  activeLoan: number;
  openClaims: number;
}): string {
  const parts: string[] = [];
  if (args.activeInsurance > 0) parts.push(`${args.activeInsurance} insurance`);
  if (args.activeLoan > 0) parts.push(`${args.activeLoan} loan`);
  if (args.openClaims > 0) parts.push(`${args.openClaims} open claim`);
  return parts.length ? parts.join(" · ") : "No active obligations";
}

function CostMixCard({
  purchase,
  service,
  fuel,
}: {
  purchase: number;
  service: number;
  fuel: number;
}) {
  const total = purchase + service + fuel;
  const segments = [
    { name: "Purchase", value: purchase, color: "#0ea5e9" },
    { name: "Service", value: service, color: "#a855f7" },
    { name: "Fuel", value: fuel, color: "#f59e0b" },
  ].filter((s) => s.value > 0);
  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">Lifetime spend</h3>
        <span className="text-xs text-muted-foreground tabular-nums">
          {formatINR(total)}
        </span>
      </div>
      {total === 0 ? (
        <p className="mt-4 text-xs text-muted-foreground">
          No spend recorded yet. Log a Vehicle Purchase / Service / Fuel expense
          tagged to this vehicle to populate this chart.
        </p>
      ) : (
        <div className="mt-3 grid grid-cols-[160px_1fr] gap-4 items-center">
          <div className="h-[160px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={segments}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={45}
                  outerRadius={70}
                  paddingAngle={2}
                  stroke="none"
                >
                  {segments.map((s) => (
                    <Cell key={s.name} fill={s.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(v) => formatINR(Number(v))}
                  contentStyle={{
                    fontSize: "12px",
                    borderRadius: "8px",
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="space-y-2 text-sm">
            {segments.map((s) => {
              const pct = total > 0 ? (s.value / total) * 100 : 0;
              return (
                <li key={s.name} className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: s.color }}
                  />
                  <span className="flex-1">{s.name}</span>
                  <span className="font-medium tabular-nums">
                    {formatINR(s.value)}
                  </span>
                  <span className="w-12 text-right text-xs text-muted-foreground tabular-nums">
                    {pct.toFixed(0)}%
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function SnapshotRow({
  icon,
  label,
  value,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  href?: string;
}) {
  const content = (
    <div className="flex items-center gap-3 rounded-lg border bg-card p-3 text-sm">
      <div className="shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className="font-medium truncate">{value}</div>
      </div>
      {href && <ArrowRight className="h-4 w-4 text-muted-foreground" />}
    </div>
  );
  return href ? (
    <Link href={href} className="block hover:opacity-90 transition-opacity">
      {content}
    </Link>
  ) : (
    content
  );
}

function TransactionRow({
  t,
}: {
  t: {
    id: string;
    description: string;
    date: string;
    amount: number;
    category: {
      id: string;
      name: string;
      parent: { id: string; name: string } | null;
    } | null;
  };
}) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm">
      <div className="min-w-0 flex-1">
        <div className="truncate">{t.description}</div>
        <div className="text-xs text-muted-foreground">
          {formatDate(t.date)}
          {t.category
            ? ` · ${t.category.parent ? `${t.category.parent.name} › ` : ""}${t.category.name}`
            : ""}
        </div>
      </div>
      <div className="font-medium tabular-nums shrink-0">
        {formatINR(t.amount)}
      </div>
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
  const [fuelType, setFuelType] = useState<Vehicle["fuelType"] | "">("");
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
    setFuelType(vehicle.fuelType ?? "");
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
        fuelType: fuelType || null,
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
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium">Registration No</span>
              <Input
                value={registrationNo}
                onChange={(e) => setRegistrationNo(e.target.value.toUpperCase())}
                maxLength={40}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium">Fuel type</span>
              <select
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={fuelType ?? ""}
                onChange={(e) =>
                  setFuelType((e.target.value || "") as Vehicle["fuelType"] | "")
                }
              >
                <option value="">— pick a fuel —</option>
                <option value="PETROL">Petrol</option>
                <option value="DIESEL">Diesel</option>
                <option value="CNG">CNG</option>
                <option value="LPG">LPG</option>
                <option value="ELECTRIC">Electric (EV)</option>
                <option value="HYBRID">Hybrid</option>
                <option value="OTHER">Other</option>
              </select>
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

/* ---------------- Fuel & Mileage ---------------- */

type FuelSummary = {
  vehicle: {
    id: string;
    name: string;
    fuelType: string | null;
    odometerStart: number | null;
  };
  totals: {
    spent: number;
    quantity: number;
    fills: number;
    unit: string | null;
  };
  kmDriven: number | null;
  averageMileage: number | null;
  fills: {
    id: string;
    date: string;
    amount: number;
    description: string;
    quantity: number;
    unit: string | null;
    odometer: number | null;
    kmSincePrev: number | null;
    mileage: number | null;
    attachments: {
      id: string;
      filename: string;
      mimeType: string;
      /** Short-lived presigned GET URL — null when S3 isn't configured. */
      url: string | null;
    }[];
  }[];
};

function FuelMileageSection({ vehicleId }: { vehicleId: string }) {
  const { data, isLoading } = useSWR<FuelSummary>(
    `/api/vehicles/${vehicleId}/fuel-summary`,
    fetcher,
  );

  if (isLoading) {
    return (
      <div className="rounded-xl border bg-card p-4 text-xs text-muted-foreground">
        Loading…
      </div>
    );
  }
  // Guard against the API's error-response shape (`{ error: string }`)
  // which the SWR fetcher returns as-is — TypeScript thinks `data` is
  // FuelSummary but at runtime an error JSON has no `totals` field.
  if (!data || !data.vehicle || !data.totals) return null;

  const { vehicle: v, totals, kmDriven, averageMileage, fills } = data;
  const unit = totals.unit ?? "L";
  const mileageUnit = `km / ${unit}`;

  if (!v.fuelType) {
    return (
      <Empty msg="Set a fuel type on this vehicle (Edit → Fuel type) to enable fuel-fill tracking with the right unit." />
    );
  }

  if (fills.length === 0) {
    return (
      <Empty msg="No fuel fills tagged yet. Add an Expense with category 'Fuel' tagged to this vehicle, with quantity + odometer reading, to start tracking mileage." />
    );
  }

  // Charts data — most-recent first in the API, reverse to chronological.
  const chronological = [...fills].reverse();
  const mileageSeries = chronological
    .filter((f) => f.mileage != null)
    .map((f) => ({
      date: new Date(f.date).toLocaleDateString("en-IN", {
        month: "short",
        day: "numeric",
      }),
      mileage: Number((f.mileage as number).toFixed(2)),
    }));
  // Group spend + qty by month.
  const monthlyMap = new Map<
    string,
    { month: string; spent: number; quantity: number }
  >();
  for (const f of chronological) {
    const d = new Date(f.date);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("en-IN", {
      month: "short",
      year: "2-digit",
    });
    const row = monthlyMap.get(key) ?? {
      month: label,
      spent: 0,
      quantity: 0,
    };
    row.spent += f.amount;
    row.quantity += f.quantity;
    monthlyMap.set(key, row);
  }
  const monthlySeries = [...monthlyMap.values()];

  return (
    <div className="space-y-4">
      {/* Stat row — corporate-grade KPI tiles for fuel domain */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiTile
          label="Total fills"
          value={String(totals.fills)}
          icon={<Fuel className="h-4 w-4" />}
        />
        <KpiTile
          label="Total fuel"
          value={`${totals.quantity.toFixed(2)} ${unit}`}
        />
        <KpiTile label="Total spent" value={formatINR(totals.spent)} />
        <KpiTile
          label="Km driven"
          value={kmDriven != null ? `${kmDriven.toLocaleString()} km` : "—"}
          icon={<Gauge className="h-4 w-4" />}
        />
      </div>
      {averageMileage != null && (
        <div className="rounded-xl border bg-emerald-50 dark:bg-emerald-950/30 p-4 flex items-baseline justify-between gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
              Average mileage
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">
              {averageMileage.toFixed(2)}{" "}
              <span className="text-base font-normal text-emerald-700/70 dark:text-emerald-300/70">
                {mileageUnit}
              </span>
            </div>
          </div>
          <div className="text-right text-xs text-muted-foreground max-w-[200px]">
            Fill-to-fill: km between earliest and latest odometer ÷ fuel
            filled between them.
          </div>
        </div>
      )}

      {/* Side-by-side charts — mileage trend (line) + monthly spend (bar) */}
      {(mileageSeries.length >= 2 || monthlySeries.length >= 2) && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {mileageSeries.length >= 2 && (
            <div className="rounded-xl border bg-card p-4">
              <div className="flex items-baseline justify-between mb-2">
                <h4 className="text-sm font-semibold">Mileage trend</h4>
                <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
                  {mileageUnit}
                </span>
              </div>
              <div className="h-[180px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={mileageSeries}
                    margin={{ top: 5, right: 10, bottom: 0, left: -20 }}
                  >
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10 }}
                      stroke="currentColor"
                      className="text-muted-foreground"
                    />
                    <YAxis
                      tick={{ fontSize: 10 }}
                      stroke="currentColor"
                      className="text-muted-foreground"
                    />
                    <Tooltip
                      formatter={(v) => `${Number(v).toFixed(2)} ${mileageUnit}`}
                      contentStyle={{ fontSize: "12px", borderRadius: "8px" }}
                    />
                    <Line
                      type="monotone"
                      dataKey="mileage"
                      stroke="#10b981"
                      strokeWidth={2}
                      dot={{ r: 3, fill: "#10b981" }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
          {monthlySeries.length >= 2 && (
            <div className="rounded-xl border bg-card p-4">
              <div className="flex items-baseline justify-between mb-2">
                <h4 className="text-sm font-semibold">Monthly fuel spend</h4>
                <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
                  ₹
                </span>
              </div>
              <div className="h-[180px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={monthlySeries}
                    margin={{ top: 5, right: 10, bottom: 0, left: -10 }}
                  >
                    <XAxis
                      dataKey="month"
                      tick={{ fontSize: 10 }}
                      stroke="currentColor"
                      className="text-muted-foreground"
                    />
                    <YAxis
                      tick={{ fontSize: 10 }}
                      stroke="currentColor"
                      className="text-muted-foreground"
                    />
                    <Tooltip
                      formatter={(v) => formatINR(Number(v))}
                      contentStyle={{ fontSize: "12px", borderRadius: "8px" }}
                    />
                    <Bar dataKey="spent" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="rounded-xl border bg-card divide-y">
        <div className="px-4 py-2.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground bg-muted/30 grid grid-cols-[1fr_auto_auto] gap-3">
          <span>Fill</span>
          <span className="text-right">Qty · Spend</span>
          <span className="text-right w-20">Mileage</span>
        </div>
        {fills.map((f) => (
          <div key={f.id} className="px-3 py-2.5 text-sm space-y-2">
            <div className="grid grid-cols-[1fr_auto_auto] gap-3 items-center">
              <div className="min-w-0">
                <div className="font-medium truncate">{f.description}</div>
                <div className="text-xs text-muted-foreground">
                  {formatDate(f.date)}
                  {f.odometer != null && ` · ${f.odometer.toLocaleString()} km`}
                  {f.kmSincePrev != null &&
                    ` · +${f.kmSincePrev.toLocaleString()} km since last`}
                </div>
              </div>
              <div className="text-right tabular-nums">
                <div className="text-sm">
                  {f.quantity.toFixed(2)}{" "}
                  <span className="text-xs text-muted-foreground">
                    {f.unit ?? unit}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatINR(f.amount)}
                </div>
              </div>
              <div className="text-right tabular-nums w-20">
                {f.mileage != null ? (
                  <span className="text-emerald-700 dark:text-emerald-400 text-sm font-medium">
                    {f.mileage.toFixed(1)}
                  </span>
                ) : (
                  <span className="text-muted-foreground text-xs">—</span>
                )}
                <div className="text-[10px] text-muted-foreground">
                  {mileageUnit}
                </div>
              </div>
            </div>
            {/* Receipt previews — image thumbnails render inline; PDFs
                and other types show a clickable file pill. Both open in
                a new tab using the short-lived presigned URL signed
                server-side on the same response. */}
            {f.attachments.length > 0 && (
              <FuelReceiptStrip attachments={f.attachments} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function FuelReceiptStrip({
  attachments,
}: {
  attachments: {
    id: string;
    filename: string;
    mimeType: string;
    url: string | null;
  }[];
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {attachments.map((a) => {
        const isImage = a.mimeType.startsWith("image/");
        if (isImage && a.url) {
          return (
            <a
              key={a.id}
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-md border bg-background overflow-hidden hover:ring-2 hover:ring-primary/30 transition"
              title={a.filename}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- presigned URL, can't go through Next/Image */}
              <img
                src={a.url}
                alt={a.filename}
                className="block h-20 w-20 object-cover"
                loading="lazy"
              />
            </a>
          );
        }
        return (
          <a
            key={a.id}
            href={a.url ?? "#"}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs hover:bg-muted/40 transition"
            title={a.filename}
          >
            <FileText className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="max-w-[14rem] truncate">{a.filename}</span>
          </a>
        );
      })}
    </div>
  );
}
