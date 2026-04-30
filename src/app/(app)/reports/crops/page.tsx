"use client";

import Link from "next/link";
import useSWR from "swr";
import { ReportShell, ReportKpi } from "@/components/reports/report-shell";
import { SortableTable, type Column } from "@/components/reports/sortable-table";
import { formatINR } from "@/lib/utils";

type ByCrop = {
  id: string;
  name: string;
  batches: number;
  income: number;
  expense: number;
  net: number;
};
type ByBatch = {
  batchId: string;
  batchName: string;
  crop: { id: string; name: string };
  status: string;
  active: boolean;
  income: number;
  expense: number;
  net: number;
};
type Payload = {
  byCrop: ByCrop[];
  batches: ByBatch[];
  totals: { income: number; expense: number; net: number };
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function CropsReportPage() {
  const { data } = useSWR<Payload>("/api/reports/crop-pnl", fetcher);
  const totals = data?.totals ?? { income: 0, expense: 0, net: 0 };
  const byCrop = data?.byCrop ?? [];
  const batches = data?.batches ?? [];

  const cropCols: Column<ByCrop>[] = [
    {
      key: "name",
      label: "Crop",
      render: (r) => (
        <Link href={`/crops/${r.id}`} className="font-medium hover:underline">
          {r.name}
        </Link>
      ),
    },
    { key: "batches", label: "Batches", align: "right", sortValue: (r) => r.batches },
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
          className={
            r.net >= 0 ? "text-primary font-semibold" : "text-destructive font-semibold"
          }
        >
          {r.net >= 0 ? "+" : "−"}
          {formatINR(Math.abs(r.net))}
        </span>
      ),
      sortValue: (r) => r.net,
    },
  ];

  const batchCols: Column<ByBatch>[] = [
    {
      key: "batchName",
      label: "Batch",
      render: (r) => (
        <div className="min-w-0">
          <div className="font-medium truncate">{r.crop.name} · {r.batchName}</div>
          <div className="text-[11px] text-muted-foreground">
            {r.status}
            {!r.active ? " · closed" : ""}
          </div>
        </div>
      ),
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
    filename: "crops_pnl",
    sheetName: "Crops P&L",
    title: "Crops P&L",
    columns: [
      { key: "crop" as const, label: "Crop", type: "string" as const },
      { key: "batchName" as const, label: "Batch", type: "string" as const },
      { key: "status" as const, label: "Status", type: "string" as const },
      { key: "income" as const, label: "Income", type: "currency" as const },
      { key: "expense" as const, label: "Expense", type: "currency" as const },
      { key: "net" as const, label: "Net", type: "currency" as const },
    ],
    rows: batches.map((b) => ({
      crop: b.crop.name,
      batchName: b.batchName,
      status: b.active ? b.status : `${b.status} (closed)`,
      income: b.income,
      expense: b.expense,
      net: b.net,
    })),
    totals: {
      crop: "Total",
      batchName: "",
      status: "",
      income: totals.income,
      expense: totals.expense,
      net: totals.net,
    },
  });

  return (
    <ReportShell
      title="Crops P&L"
      description="Per-crop and per-batch income vs expense from tagged transactions."
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
          <ReportKpi label="Batches" value={String(batches.length)} tone="muted" />
        </>
      }
      exportPayload={buildExport}
    >
      <section>
        <h2 className="text-sm font-semibold mb-2">By crop</h2>
        <SortableTable
          columns={cropCols}
          rows={byCrop}
          rowKey={(r) => r.id}
          defaultSort={{ key: "net", dir: "desc" }}
          emptyLabel="No crop data yet"
          totals={{
            name: "Total",
            income: formatINR(totals.income),
            expense: formatINR(totals.expense),
            net: (
              <span className={totals.net >= 0 ? "text-primary" : "text-destructive"}>
                {totals.net >= 0 ? "+" : "−"}
                {formatINR(Math.abs(totals.net))}
              </span>
            ),
          }}
        />
      </section>
      <section>
        <h2 className="text-sm font-semibold mb-2">By batch</h2>
        <SortableTable
          columns={batchCols}
          rows={batches}
          rowKey={(r) => r.batchId}
          defaultSort={{ key: "net", dir: "desc" }}
          emptyLabel="No batches yet"
        />
      </section>
    </ReportShell>
  );
}
