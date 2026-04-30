"use client";

import useSWR from "swr";
import { ReportShell, ReportKpi } from "@/components/reports/report-shell";
import { SortableTable, type Column } from "@/components/reports/sortable-table";
import { formatINR, formatDate } from "@/lib/utils";

type Row = {
  batchId: string;
  batchName: string;
  livestock: { id: string; name: string };
  active: boolean;
  currentCount: number;
  initialCount: number;
  startDate: string;
  income: number;
  expense: number;
  net: number;
};
type Payload = {
  batches: Row[];
  totals: { income: number; expense: number; net: number };
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function LivestockReportPage() {
  const { data } = useSWR<Payload>("/api/reports/livestock-pnl", fetcher);
  const batches = data?.batches ?? [];
  const totals = data?.totals ?? { income: 0, expense: 0, net: 0 };

  const cols: Column<Row>[] = [
    {
      key: "batchName",
      label: "Batch",
      render: (r) => (
        <div className="min-w-0">
          <div className="font-medium truncate">
            {r.livestock.name} · {r.batchName}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {r.currentCount} head (from {r.initialCount}) · started {formatDate(r.startDate)}
            {!r.active ? " · closed" : ""}
          </div>
        </div>
      ),
    },
    {
      key: "currentCount",
      label: "Head",
      align: "right",
      sortValue: (r) => r.currentCount,
    },
    {
      key: "income",
      label: "Income",
      align: "right",
      render: (r) => formatINR(r.income),
      sortValue: (r) => r.income,
    },
    {
      key: "expense",
      label: "Expense",
      align: "right",
      render: (r) => formatINR(r.expense),
      sortValue: (r) => r.expense,
    },
    {
      key: "net",
      label: "Net",
      align: "right",
      render: (r) => (
        <span
          className={r.net >= 0 ? "text-primary font-semibold" : "text-destructive font-semibold"}
        >
          {r.net >= 0 ? "+" : "−"}
          {formatINR(Math.abs(r.net))}
        </span>
      ),
      sortValue: (r) => r.net,
    },
  ];

  const buildExport = () => ({
    filename: "livestock_pnl",
    sheetName: "Livestock P&L",
    title: "Livestock P&L",
    columns: [
      { key: "livestock" as const, label: "Livestock", type: "string" as const },
      { key: "batchName" as const, label: "Batch", type: "string" as const },
      { key: "currentCount" as const, label: "Current head", type: "number" as const },
      { key: "initialCount" as const, label: "Initial head", type: "number" as const },
      { key: "startDate" as const, label: "Started", type: "date" as const },
      { key: "income" as const, label: "Income", type: "currency" as const },
      { key: "expense" as const, label: "Expense", type: "currency" as const },
      { key: "net" as const, label: "Net", type: "currency" as const },
    ],
    rows: batches.map((b) => ({
      livestock: b.livestock.name,
      batchName: b.batchName,
      currentCount: b.currentCount,
      initialCount: b.initialCount,
      startDate: b.startDate,
      income: b.income,
      expense: b.expense,
      net: b.net,
    })),
    totals: {
      livestock: "Total",
      batchName: "",
      currentCount: batches.reduce((s, b) => s + b.currentCount, 0),
      initialCount: batches.reduce((s, b) => s + b.initialCount, 0),
      income: totals.income,
      expense: totals.expense,
      net: totals.net,
    },
  });

  return (
    <ReportShell
      title="Livestock P&L"
      description="Per-batch livestock revenue, cost, and net contribution."
      kpis={
        <>
          <ReportKpi label="Income" value={formatINR(totals.income)} tone="primary" />
          <ReportKpi label="Expense" value={formatINR(totals.expense)} tone="destructive" />
          <ReportKpi
            label="Net"
            value={`${totals.net >= 0 ? "+" : "−"}${formatINR(Math.abs(totals.net))}`}
            tone={totals.net >= 0 ? "primary" : "destructive"}
            highlight
          />
          <ReportKpi
            label="Total head"
            value={String(batches.reduce((s, b) => s + b.currentCount, 0))}
            tone="muted"
          />
        </>
      }
      exportPayload={buildExport}
    >
      <SortableTable
        columns={cols}
        rows={batches}
        rowKey={(r) => r.batchId}
        defaultSort={{ key: "net", dir: "desc" }}
        emptyLabel="No livestock batches yet"
      />
    </ReportShell>
  );
}
