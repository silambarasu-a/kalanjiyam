"use client";

import Link from "next/link";
import useSWR from "swr";
import { ReportShell, ReportKpi } from "@/components/reports/report-shell";
import { SortableTable, type Column } from "@/components/reports/sortable-table";
import { formatINR } from "@/lib/utils";

type Row = {
  id: string;
  name: string;
  relationship: string | null;
  active: boolean;
  totalCharged: number;
  totalSettled: number;
  outstanding: number;
  chargeCount: number;
};
type Payload = {
  members: Row[];
  totals: { totalCharged: number; totalSettled: number; outstanding: number };
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function MembersReportPage() {
  const { data } = useSWR<Payload>("/api/reports/member-ledger", fetcher);
  const members = data?.members ?? [];
  const totals = data?.totals ?? {
    totalCharged: 0,
    totalSettled: 0,
    outstanding: 0,
  };

  const cols: Column<Row>[] = [
    {
      key: "name",
      label: "Contact",
      render: (r) => (
        <div className="min-w-0">
          <Link
            href={`/contacts/${r.id}`}
            className="font-medium hover:underline truncate block"
          >
            {r.name}
          </Link>
          <div className="text-[11px] text-muted-foreground">
            {r.relationship ?? "—"}
            {!r.active ? " · inactive" : ""}
          </div>
        </div>
      ),
    },
    {
      key: "chargeCount",
      label: "Charges",
      align: "right",
      sortValue: (r) => r.chargeCount,
    },
    {
      key: "totalCharged",
      label: "Charged",
      align: "right",
      render: (r) => formatINR(r.totalCharged),
      sortValue: (r) => r.totalCharged,
    },
    {
      key: "totalSettled",
      label: "Settled",
      align: "right",
      render: (r) => formatINR(r.totalSettled),
      sortValue: (r) => r.totalSettled,
    },
    {
      key: "outstanding",
      label: "Outstanding",
      align: "right",
      render: (r) => (
        <span
          className={
            r.outstanding > 0
              ? "text-destructive font-semibold"
              : "text-muted-foreground"
          }
        >
          {formatINR(r.outstanding)}
        </span>
      ),
      sortValue: (r) => r.outstanding,
    },
  ];

  const buildExport = () => ({
    filename: "member_ledger",
    sheetName: "Member ledger",
    title: "Member Ledger",
    columns: [
      { key: "name" as const, label: "Contact", type: "string" as const },
      { key: "relationship" as const, label: "Relationship", type: "string" as const },
      { key: "active" as const, label: "Active", type: "string" as const },
      { key: "chargeCount" as const, label: "Charges", type: "number" as const },
      { key: "totalCharged" as const, label: "Charged", type: "currency" as const },
      { key: "totalSettled" as const, label: "Settled", type: "currency" as const },
      { key: "outstanding" as const, label: "Outstanding", type: "currency" as const },
    ],
    rows: members,
    totals: {
      name: "Total",
      totalCharged: totals.totalCharged,
      totalSettled: totals.totalSettled,
      outstanding: totals.outstanding,
    },
  });

  return (
    <ReportShell
      title="Member ledger"
      description="Outstanding recoverable charges per contact, with lifetime charged and settled."
      kpis={
        <>
          <ReportKpi
            label="Outstanding"
            value={formatINR(totals.outstanding)}
            tone="destructive"
            highlight
          />
          <ReportKpi
            label="Charged"
            value={formatINR(totals.totalCharged)}
            tone="muted"
          />
          <ReportKpi
            label="Settled"
            value={formatINR(totals.totalSettled)}
            tone="primary"
          />
          <ReportKpi
            label="Contacts"
            value={String(members.length)}
            tone="muted"
          />
        </>
      }
      exportPayload={buildExport}
    >
      <SortableTable
        columns={cols}
        rows={members}
        rowKey={(r) => r.id}
        defaultSort={{ key: "outstanding", dir: "desc" }}
        emptyLabel="No contacts yet"
        totals={{
          name: "Total",
          totalCharged: formatINR(totals.totalCharged),
          totalSettled: formatINR(totals.totalSettled),
          outstanding: formatINR(totals.outstanding),
        }}
      />
    </ReportShell>
  );
}
