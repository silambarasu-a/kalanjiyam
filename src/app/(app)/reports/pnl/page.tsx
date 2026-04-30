"use client";

import { useState } from "react";
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
  group: string | null;
  type: "INCOME" | "EXPENSE";
  amount: number;
  prevAmount: number;
  change: number;
  changePct: number;
  count: number;
};
type Payload = {
  income: Row[];
  expense: Row[];
  totals: {
    income: number;
    expense: number;
    net: number;
    prevIncome: number;
    prevExpense: number;
    prevNet: number;
  };
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function PnLReportPage() {
  const [preset, setPreset] = useState<DatePreset>("this-month");
  const [range, setRange] = useState<DateRange>(() => presetRange("this-month"));
  const { data } = useSWR<Payload>(
    `/api/reports/pnl?start=${range.start}&end=${range.end}`,
    fetcher,
  );

  const totals = data?.totals ?? {
    income: 0,
    expense: 0,
    net: 0,
    prevIncome: 0,
    prevExpense: 0,
    prevNet: 0,
  };

  const cols: Column<Row>[] = [
    { key: "name", label: "Category" },
    {
      key: "count",
      label: "Txns",
      align: "right",
      sortValue: (r) => r.count,
    },
    {
      key: "prevAmount",
      label: "Prior period",
      align: "right",
      render: (r) => formatINR(r.prevAmount),
      sortValue: (r) => r.prevAmount,
    },
    {
      key: "amount",
      label: "Current",
      align: "right",
      render: (r) => formatINR(r.amount),
      sortValue: (r) => r.amount,
    },
    {
      key: "change",
      label: "Δ",
      align: "right",
      sortValue: (r) => r.change,
      render: (r) => (
        <span
          className={
            r.change > 0
              ? r.type === "INCOME"
                ? "text-primary"
                : "text-destructive"
              : r.change < 0
                ? r.type === "INCOME"
                  ? "text-destructive"
                  : "text-primary"
                : "text-muted-foreground"
          }
        >
          {r.change > 0 ? "+" : r.change < 0 ? "−" : ""}
          {formatINR(Math.abs(r.change))}
          {r.changePct !== 0 && (
            <span className="ml-1 text-[11px] text-muted-foreground">
              ({r.changePct > 0 ? "+" : ""}
              {r.changePct.toFixed(0)}%)
            </span>
          )}
        </span>
      ),
    },
  ];

  const buildExport = () => ({
    filename: `pnl_${range.start}_${range.end}`,
    sheetName: "P&L",
    title: "Profit & Loss by Category",
    subtitle: `${range.start} to ${range.end}`,
    columns: [
      { key: "type" as const, label: "Type", type: "string" as const },
      { key: "name" as const, label: "Category", type: "string" as const },
      { key: "count" as const, label: "Txns", type: "number" as const },
      { key: "prevAmount" as const, label: "Prior period", type: "currency" as const },
      { key: "amount" as const, label: "Current", type: "currency" as const },
      { key: "change" as const, label: "Change", type: "currency" as const },
      { key: "changePct" as const, label: "Change %", type: "number" as const },
    ],
    rows: [...(data?.income ?? []), ...(data?.expense ?? [])],
    totals: {
      type: "Total",
      name: "",
      count: "",
      prevAmount: totals.prevNet,
      amount: totals.net,
      change: totals.net - totals.prevNet,
      changePct: "",
    },
  });

  return (
    <ReportShell
      title="Profit & Loss"
      description="Income and expense by category for the selected period, with prior-period comparison."
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
          <ReportKpi label="Income" value={formatINR(totals.income)} tone="primary" />
          <ReportKpi label="Expense" value={formatINR(totals.expense)} tone="destructive" />
          <ReportKpi
            label="Net"
            value={`${totals.net >= 0 ? "+" : "−"}${formatINR(Math.abs(totals.net))}`}
            tone={totals.net >= 0 ? "primary" : "destructive"}
            highlight
          />
          <ReportKpi
            label="Prior net"
            value={`${totals.prevNet >= 0 ? "+" : "−"}${formatINR(Math.abs(totals.prevNet))}`}
            tone="muted"
          />
        </>
      }
      exportPayload={buildExport}
    >
      <section>
        <h2 className="text-sm font-semibold mb-2">Income</h2>
        <SortableTable
          columns={cols}
          rows={data?.income ?? []}
          rowKey={(r) => r.id}
          defaultSort={{ key: "amount", dir: "desc" }}
          totals={{
            name: "Total income",
            amount: formatINR(totals.income),
            prevAmount: formatINR(totals.prevIncome),
            change: (
              <span
                className={
                  totals.income - totals.prevIncome >= 0
                    ? "text-primary"
                    : "text-destructive"
                }
              >
                {totals.income - totals.prevIncome >= 0 ? "+" : "−"}
                {formatINR(Math.abs(totals.income - totals.prevIncome))}
              </span>
            ),
          }}
          emptyLabel="No income in this period"
        />
      </section>
      <section>
        <h2 className="text-sm font-semibold mb-2">Expense</h2>
        <SortableTable
          columns={cols}
          rows={data?.expense ?? []}
          rowKey={(r) => r.id}
          defaultSort={{ key: "amount", dir: "desc" }}
          totals={{
            name: "Total expense",
            amount: formatINR(totals.expense),
            prevAmount: formatINR(totals.prevExpense),
            change: (
              <span
                className={
                  totals.expense - totals.prevExpense <= 0
                    ? "text-primary"
                    : "text-destructive"
                }
              >
                {totals.expense - totals.prevExpense >= 0 ? "+" : "−"}
                {formatINR(Math.abs(totals.expense - totals.prevExpense))}
              </span>
            ),
          }}
          emptyLabel="No expense in this period"
        />
      </section>
    </ReportShell>
  );
}
