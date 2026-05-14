"use client";

import Link from "next/link";
import { use, useMemo } from "react";
import useSWR from "swr";
import { ArrowLeft } from "lucide-react";
import { formatINR, formatDate } from "@/lib/utils";

type Txn = {
  id: string;
  amount: number;
  date: string;
  description: string;
  hospitalizationStage: "PRE" | "DURING" | "POST" | null;
  category: {
    id: string;
    name: string;
    parent: { id: string; name: string } | null;
  } | null;
  account: { id: string; name: string } | null;
  card: { id: string; name: string } | null;
};

type Claim = {
  id: string;
  claimNumber: string | null;
  status: string;
  claimedAmount: number | null;
  approvedAmount: number | null;
  receivedAmount: number | null;
  investmentId: string;
};

type Hospitalization = {
  id: string;
  hospitalName: string;
  diagnosis: string | null;
  admittedAt: string;
  dischargedAt: string | null;
  notes: string | null;
  patientContact: { id: string; name: string; relationship: string | null };
  claim: Claim | null;
  transactions: Txn[];
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const STAGE_LABEL: Record<"PRE" | "DURING" | "POST", string> = {
  PRE: "Pre-hospitalization",
  DURING: "Hospitalization",
  POST: "Post-hospitalization",
};

export default function MedicalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data, isLoading } = useSWR<{ hospitalization: Hospitalization }>(
    `/api/hospitalizations/${id}`,
    fetcher,
  );
  const h = data?.hospitalization;

  const grouped = useMemo(() => {
    const buckets: Record<"PRE" | "DURING" | "POST", Txn[]> = {
      PRE: [],
      DURING: [],
      POST: [],
    };
    let total = 0;
    if (h) {
      for (const t of h.transactions) {
        const stage = t.hospitalizationStage ?? "DURING";
        buckets[stage].push(t);
        total += t.amount;
      }
    }
    return { buckets, total };
  }, [h]);

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!h)
    return (
      <p className="text-sm text-muted-foreground">
        Episode not found.{" "}
        <Link href="/medical" className="underline">
          Back to medical records
        </Link>
      </p>
    );

  const reimbursement = h.claim?.receivedAmount ?? 0;
  const outOfPocket = Math.max(0, grouped.total - reimbursement);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/medical"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> All records
        </Link>
        <div className="mt-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {h.patientContact.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            {h.hospitalName}
            {h.diagnosis ? ` · ${h.diagnosis}` : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            Admitted {formatDate(h.admittedAt)}
            {h.dischargedAt ? ` · Discharged ${formatDate(h.dischargedAt)}` : " · Ongoing"}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Cell label="Pre" value={formatINR(sum(grouped.buckets.PRE))} />
        <Cell label="During" value={formatINR(sum(grouped.buckets.DURING))} />
        <Cell label="Post" value={formatINR(sum(grouped.buckets.POST))} />
        <Cell label="Total spend" value={formatINR(grouped.total)} highlight />
      </div>

      {h.claim && (
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Linked claim
              </div>
              <div className="mt-1 text-sm">
                <Link
                  href={`/insurance/${h.claim.investmentId}?claim=${h.claim.id}`}
                  className="underline"
                >
                  {h.claim.claimNumber ?? "Claim"}
                </Link>{" "}
                · {h.claim.status.replace("_", " ").toLowerCase()}
              </div>
            </div>
            <div className="text-right text-sm">
              {h.claim.claimedAmount != null && (
                <div className="text-xs text-muted-foreground">
                  Claimed {formatINR(h.claim.claimedAmount)}
                </div>
              )}
              {h.claim.receivedAmount != null && (
                <div className="font-medium">
                  Received {formatINR(h.claim.receivedAmount)}
                </div>
              )}
              <div className="mt-1 text-xs text-muted-foreground">
                Out of pocket {formatINR(outOfPocket)}
              </div>
            </div>
          </div>
        </div>
      )}

      {(["PRE", "DURING", "POST"] as const).map((stage) => {
        const items = grouped.buckets[stage];
        return (
          <div key={stage} className="space-y-2">
            <h2 className="text-sm font-medium">
              {STAGE_LABEL[stage]}{" "}
              <span className="text-xs text-muted-foreground">
                ({items.length}) · {formatINR(sum(items))}
              </span>
            </h2>
            <div className="rounded-lg border bg-card divide-y">
              {items.length === 0 && (
                <p className="p-3 text-xs text-muted-foreground">No bills in this stage.</p>
              )}
              {items.map((t) => (
                <div
                  key={t.id}
                  className="flex items-start justify-between gap-3 p-3 text-sm"
                >
                  <div>
                    <div>{t.description}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatDate(t.date)}
                      {t.category
                        ? ` · ${t.category.parent ? `${t.category.parent.name} › ` : ""}${t.category.name}`
                        : ""}
                      {t.account ? ` · ${t.account.name}` : ""}
                      {t.card ? ` · ${t.card.name}` : ""}
                    </div>
                  </div>
                  <div className="font-medium">{formatINR(t.amount)}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {h.notes && (
        <div className="rounded-lg border bg-card p-4 text-sm">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Notes</div>
          <div className="mt-1">{h.notes}</div>
        </div>
      )}
    </div>
  );
}

function Cell({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border bg-card p-3 ${
        highlight ? "border-foreground/60" : ""
      }`}
    >
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-base font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function sum(arr: { amount: number }[]): number {
  return arr.reduce((a, t) => a + t.amount, 0);
}
