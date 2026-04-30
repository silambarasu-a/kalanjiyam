"use client";

import Link from "next/link";
import useSWR from "swr";
import { ReportShell, ReportKpi } from "@/components/reports/report-shell";
import { SortableTable, type Column } from "@/components/reports/sortable-table";
import { formatINR } from "@/lib/utils";

type Row = {
  id: string;
  name: string;
  kind: string;
  institution: string | null;
  symbol: string | null;
  cost: number;
  currentValue: number;
  dividends: number;
  pnl: number;
  pnlPct: number;
  startedAt: string;
  maturityAt: string | null;
  active: boolean;
  currency: string;
};
type Payload = {
  rows: Row[];
  totals: {
    cost: number;
    currentValue: number;
    dividends: number;
    pnl: number;
    pnlPct: number;
    activeCount: number;
  };
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function InvestmentsReportPage() {
  const { data } = useSWR<Payload>("/api/reports/investments", fetcher);
  const rows = data?.rows ?? [];
  const totals = data?.totals ?? {
    cost: 0,
    currentValue: 0,
    dividends: 0,
    pnl: 0,
    pnlPct: 0,
    activeCount: 0,
  };

  const cols: Column<Row>[] = [
    {
      key: "name",
      label: "Holding",
      render: (r) => (
        <div className="min-w-0">
          <Link
            href={`/investments/${r.id}`}
            className="font-medium hover:underline truncate block"
          >
            {r.name}
          </Link>
          <div className="text-[11px] text-muted-foreground">
            {r.kind}
            {r.institution ? ` · ${r.institution}` : ""}
            {r.symbol ? ` · ${r.symbol}` : ""}
          </div>
        </div>
      ),
    },
    {
      key: "cost",
      label: "Invested",
      align: "right",
      render: (r) => formatINR(r.cost),
      sortValue: (r) => r.cost,
    },
    {
      key: "currentValue",
      label: "Current value",
      align: "right",
      render: (r) => formatINR(r.currentValue),
      sortValue: (r) => r.currentValue,
    },
    {
      key: "dividends",
      label: "Dividends",
      align: "right",
      render: (r) => formatINR(r.dividends),
      sortValue: (r) => r.dividends,
    },
    {
      key: "pnl",
      label: "Unrealised P&L",
      align: "right",
      render: (r) => (
        <span
          className={
            r.pnl >= 0 ? "text-primary font-semibold" : "text-destructive font-semibold"
          }
        >
          {r.pnl >= 0 ? "+" : "−"}
          {formatINR(Math.abs(r.pnl))}
          <span className="ml-1 text-[11px] text-muted-foreground">
            ({r.pnlPct >= 0 ? "+" : ""}
            {r.pnlPct.toFixed(1)}%)
          </span>
        </span>
      ),
      sortValue: (r) => r.pnl,
    },
  ];

  const buildExport = () => ({
    filename: "investment_portfolio",
    sheetName: "Investments",
    title: "Investment Portfolio",
    subtitle: `${totals.activeCount} active holdings`,
    columns: [
      { key: "name" as const, label: "Holding", type: "string" as const },
      { key: "kind" as const, label: "Kind", type: "string" as const },
      { key: "institution" as const, label: "Institution", type: "string" as const },
      { key: "symbol" as const, label: "Symbol", type: "string" as const },
      { key: "cost" as const, label: "Invested", type: "currency" as const },
      { key: "currentValue" as const, label: "Current value", type: "currency" as const },
      { key: "dividends" as const, label: "Dividends", type: "currency" as const },
      { key: "pnl" as const, label: "Unrealised P&L", type: "currency" as const },
      { key: "pnlPct" as const, label: "P&L %", type: "number" as const },
      { key: "startedAt" as const, label: "Started", type: "date" as const },
      { key: "maturityAt" as const, label: "Maturity", type: "date" as const },
      { key: "active" as const, label: "Active", type: "string" as const },
    ],
    rows,
    totals: {
      name: "Total",
      cost: totals.cost,
      currentValue: totals.currentValue,
      dividends: totals.dividends,
      pnl: totals.pnl,
      pnlPct: totals.pnlPct,
    },
  });

  return (
    <ReportShell
      title="Investment portfolio"
      description="Holdings with cost basis, current value, dividends, and unrealised P&L."
      kpis={
        <>
          <ReportKpi label="Invested" value={formatINR(totals.cost)} tone="muted" />
          <ReportKpi
            label="Current value"
            value={formatINR(totals.currentValue)}
            tone="primary"
          />
          <ReportKpi
            label="Unrealised P&L"
            value={`${totals.pnl >= 0 ? "+" : "−"}${formatINR(Math.abs(totals.pnl))}`}
            hint={`${totals.pnlPct >= 0 ? "+" : ""}${totals.pnlPct.toFixed(1)}%`}
            tone={totals.pnl >= 0 ? "primary" : "destructive"}
            highlight
          />
          <ReportKpi
            label="Dividends"
            value={formatINR(totals.dividends)}
            tone="primary"
          />
        </>
      }
      exportPayload={buildExport}
    >
      <SortableTable
        columns={cols}
        rows={rows}
        rowKey={(r) => r.id}
        defaultSort={{ key: "currentValue", dir: "desc" }}
        emptyLabel="No investments yet"
        totals={{
          name: "Total",
          cost: formatINR(totals.cost),
          currentValue: formatINR(totals.currentValue),
          dividends: formatINR(totals.dividends),
          pnl: (
            <span className={totals.pnl >= 0 ? "text-primary" : "text-destructive"}>
              {totals.pnl >= 0 ? "+" : "−"}
              {formatINR(Math.abs(totals.pnl))}
            </span>
          ),
        }}
      />
    </ReportShell>
  );
}
