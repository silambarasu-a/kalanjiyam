"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { ReportShell, ReportKpi } from "@/components/reports/report-shell";
import {
  ReportFilters,
  presetRange,
  type DatePreset,
  type DateRange,
} from "@/components/reports/report-filters";
import { SortableTable, type Column } from "@/components/reports/sortable-table";
import { formatINR } from "@/lib/utils";

type Row = {
  id: string;
  name: string;
  kind: "DEBIT" | "CREDIT";
  network: string;
  last4: string | null;
  creditLimit: number | null;
  spend: number;
  txns: number;
};
type Payload = {
  rows: Row[];
  totals: { spend: number; txns: number };
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function CardSpendReportPage() {
  const [preset, setPreset] = useState<DatePreset>("this-month");
  const [range, setRange] = useState<DateRange>(() => presetRange("this-month"));
  const { data } = useSWR<Payload>(
    `/api/reports/cards?start=${range.start}&end=${range.end}`,
    fetcher,
  );
  const rows = data?.rows ?? [];
  const totals = data?.totals ?? { spend: 0, txns: 0 };

  const cols: Column<Row>[] = [
    {
      key: "name",
      label: "Card",
      render: (r) => (
        <div className="min-w-0">
          <Link
            href={`/cards/${r.id}`}
            className="font-medium hover:underline truncate block"
          >
            {r.name}
          </Link>
          <div className="text-[11px] text-muted-foreground">
            {r.kind} · {r.network}
            {r.last4 ? ` · ••${r.last4}` : ""}
          </div>
        </div>
      ),
    },
    {
      key: "txns",
      label: "Txns",
      align: "right",
      sortValue: (r) => r.txns,
    },
    {
      key: "spend",
      label: "Spend",
      align: "right",
      render: (r) => formatINR(r.spend),
      sortValue: (r) => r.spend,
    },
    {
      key: "creditLimit",
      label: "Limit",
      align: "right",
      render: (r) => (r.creditLimit == null ? "—" : formatINR(r.creditLimit)),
      sortValue: (r) => r.creditLimit ?? 0,
    },
  ];

  const buildExport = () => ({
    filename: `card_spend_${range.start}_${range.end}`,
    sheetName: "Card spend",
    title: "Card Spend",
    subtitle: `${range.start} to ${range.end}`,
    columns: [
      { key: "name" as const, label: "Card", type: "string" as const },
      { key: "kind" as const, label: "Kind", type: "string" as const },
      { key: "network" as const, label: "Network", type: "string" as const },
      { key: "last4" as const, label: "Last 4", type: "string" as const },
      { key: "txns" as const, label: "Txns", type: "number" as const },
      { key: "spend" as const, label: "Spend", type: "currency" as const },
      { key: "creditLimit" as const, label: "Credit limit", type: "currency" as const },
    ],
    rows,
    totals: { name: "Total", txns: totals.txns, spend: totals.spend },
  });

  return (
    <ReportShell
      title="Card spend"
      description="Spend by card within the selected window."
      filters={
        <ReportFilters
          preset={preset}
          onPresetChange={setPreset}
          range={range}
          onRangeChange={setRange}
        />
      }
      kpis={
        <>
          <ReportKpi
            label="Total spend"
            value={formatINR(totals.spend)}
            tone="destructive"
            highlight
          />
          <ReportKpi label="Transactions" value={String(totals.txns)} tone="muted" />
          <ReportKpi label="Cards" value={String(rows.length)} tone="muted" />
          <ReportKpi
            label="Avg per card"
            value={
              rows.length > 0
                ? formatINR(totals.spend / rows.length)
                : "—"
            }
            tone="muted"
          />
        </>
      }
      exportPayload={buildExport}
    >
      <SortableTable
        columns={cols}
        rows={rows}
        rowKey={(r) => r.id}
        defaultSort={{ key: "spend", dir: "desc" }}
        emptyLabel="No cards in this workspace"
        totals={{
          name: "Total",
          txns: String(totals.txns),
          spend: formatINR(totals.spend),
        }}
      />
    </ReportShell>
  );
}
