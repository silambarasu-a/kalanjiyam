"use client";

import Link from "next/link";
import { use, useMemo } from "react";
import useSWR from "swr";
import { ArrowLeft, Fuel, Wrench, ShoppingCart } from "lucide-react";
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
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{vehicle.name}</h1>
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
        </div>
      </div>

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
  title: string;
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
