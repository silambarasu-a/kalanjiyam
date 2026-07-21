"use client";

import Link from "next/link";
import { use, useMemo } from "react";
import useSWR from "swr";
import { ArrowLeft } from "lucide-react";
import { KIND_LABEL } from "@/components/medical/record-dialog";
import type { MedicalRecordKind } from "@/components/medical/record-dialog";
import { formatINR, formatDate } from "@/lib/utils";
import { fetcher } from "@/lib/swr-fetcher";

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

type MedicalRecord = {
  id: string;
  kind: MedicalRecordKind;
  facilityName: string;
  diagnosis: string | null;
  occurredAt: string;
  dischargedAt: string | null;
  notes: string | null;
  patientContact: { id: string; name: string; relationship: string | null };
  claim: Claim | null;
  transactions: Txn[];
};

const STAGE_LABEL: Record<"PRE" | "DURING" | "POST", string> = {
  PRE: "Pre-hospitalization",
  DURING: "Hospitalization",
  POST: "Post-hospitalization",
};

export default function MedicalRecordDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data, isLoading } = useSWR<{ record: MedicalRecord }>(
    `/api/medical-records/${id}`,
    fetcher,
  );
  const record = data?.record;
  const isHospitalization = record?.kind === "HOSPITALIZATION";

  const grouped = useMemo(() => {
    const buckets: Record<"PRE" | "DURING" | "POST", Txn[]> = {
      PRE: [],
      DURING: [],
      POST: [],
    };
    let total = 0;
    if (record) {
      for (const t of record.transactions) {
        const stage = t.hospitalizationStage ?? "DURING";
        buckets[stage].push(t);
        total += t.amount;
      }
    }
    return { buckets, total };
  }, [record]);

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!record)
    return (
      <p className="text-sm text-muted-foreground">
        Record not found.{" "}
        <Link href="/medical" className="underline">
          Back to medical records
        </Link>
      </p>
    );

  const reimbursement = record.claim?.receivedAmount ?? 0;
  const outOfPocket = Math.max(0, grouped.total - reimbursement);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/medical/${record.patientContact.id}`}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> {record.patientContact.name}&apos;s history
        </Link>
        <div className="mt-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {record.facilityName}
            </h1>
            <span className="rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              {KIND_LABEL[record.kind]}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            {record.patientContact.name}
            {record.diagnosis ? ` · ${record.diagnosis}` : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            {isHospitalization
              ? `Admitted ${formatDate(record.occurredAt)}${
                  record.dischargedAt
                    ? ` · Discharged ${formatDate(record.dischargedAt)}`
                    : " · Ongoing"
                }`
              : `Visited ${formatDate(record.occurredAt)}`}
          </p>
        </div>
      </div>

      {isHospitalization ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Cell label="Pre" value={formatINR(sum(grouped.buckets.PRE))} />
          <Cell label="During" value={formatINR(sum(grouped.buckets.DURING))} />
          <Cell label="Post" value={formatINR(sum(grouped.buckets.POST))} />
          <Cell label="Total spend" value={formatINR(grouped.total)} highlight />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Cell label="Total spend" value={formatINR(grouped.total)} highlight />
        </div>
      )}

      {record.claim && (
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Linked claim
              </div>
              <div className="mt-1 text-sm">
                <Link
                  href={`/insurance/${record.claim.investmentId}?claim=${record.claim.id}`}
                  className="underline"
                >
                  {record.claim.claimNumber ?? "Claim"}
                </Link>{" "}
                · {record.claim.status.replace("_", " ").toLowerCase()}
              </div>
            </div>
            <div className="text-right text-sm">
              {record.claim.claimedAmount != null && (
                <div className="text-xs text-muted-foreground">
                  Claimed {formatINR(record.claim.claimedAmount)}
                </div>
              )}
              {record.claim.receivedAmount != null && (
                <div className="font-medium">
                  Received {formatINR(record.claim.receivedAmount)}
                </div>
              )}
              <div className="mt-1 text-xs text-muted-foreground">
                Out of pocket {formatINR(outOfPocket)}
              </div>
            </div>
          </div>
        </div>
      )}

      {isHospitalization ? (
        (["PRE", "DURING", "POST"] as const).map((stage) => {
          const items = grouped.buckets[stage];
          return (
            <div key={stage} className="space-y-2">
              <h2 className="text-sm font-medium">
                {STAGE_LABEL[stage]}{" "}
                <span className="text-xs text-muted-foreground">
                  ({items.length}) · {formatINR(sum(items))}
                </span>
              </h2>
              <TxnList items={items} emptyLabel="No bills in this stage." />
            </div>
          );
        })
      ) : (
        <div className="space-y-2">
          <h2 className="text-sm font-medium">
            Bills{" "}
            <span className="text-xs text-muted-foreground">
              ({record.transactions.length}) · {formatINR(grouped.total)}
            </span>
          </h2>
          <TxnList
            items={record.transactions}
            emptyLabel="No bills tagged to this visit yet."
          />
        </div>
      )}

      {record.notes && (
        <div className="rounded-lg border bg-card p-4 text-sm">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Notes</div>
          <div className="mt-1">{record.notes}</div>
        </div>
      )}
    </div>
  );
}

function TxnList({ items, emptyLabel }: { items: Txn[]; emptyLabel: string }) {
  return (
    <div className="rounded-lg border bg-card divide-y">
      {items.length === 0 && (
        <p className="p-3 text-xs text-muted-foreground">{emptyLabel}</p>
      )}
      {items.map((t) => (
        <div key={t.id} className="flex items-start justify-between gap-3 p-3 text-sm">
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
