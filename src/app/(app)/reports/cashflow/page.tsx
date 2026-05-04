"use client";

import { useMemo, useState } from "react";
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

type Series = {
  month: string;
  income: number;
  expense: number;
  net: number;
};
type CategoryRow = {
  id: string;
  name: string;
  group: string | null;
  amount: number;
};
type Payload = {
  rangeStart: string;
  rangeEnd: string;
  series: Series[];
  totals: { income: number; expense: number; net: number };
  topIncome: CategoryRow[];
  topExpense: CategoryRow[];
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function CashflowReportPage() {
  const [preset, setPreset] = useState<DatePreset>("last-12m");
  const [range, setRange] = useState<DateRange>(() => presetRange("last-12m"));
  const { data, isLoading } = useSWR<Payload>(
    `/api/reports/cashflow?start=${range.start}&end=${range.end}`,
    fetcher,
  );

  const series = useMemo(() => data?.series ?? [], [data?.series]);
  const totals = data?.totals ?? { income: 0, expense: 0, net: 0 };

  const maxBar = useMemo(
    () => Math.max(1, ...series.map((s) => Math.max(s.income, s.expense))),
    [series],
  );

  const monthCols: Column<Series>[] = [
    { key: "month", label: "Month" },
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
        <span className={r.net >= 0 ? "text-primary" : "text-destructive"}>
          {r.net >= 0 ? "+" : "−"}
          {formatINR(Math.abs(r.net))}
        </span>
      ),
      sortValue: (r) => r.net,
    },
  ];

  const buildExport = () => ({
    filename: `cashflow_${range.start}_${range.end}`,
    sheetName: "Cashflow",
    title: "Cashflow Statement",
    subtitle: `${range.start} to ${range.end}`,
    columns: [
      { key: "month" as const, label: "Month", type: "string" as const },
      { key: "income" as const, label: "Income", type: "currency" as const },
      { key: "expense" as const, label: "Expense", type: "currency" as const },
      { key: "net" as const, label: "Net", type: "currency" as const },
    ],
    rows: series,
    totals: {
      month: "Total",
      income: totals.income,
      expense: totals.expense,
      net: totals.net,
    },
  });

  return (
    <ReportShell
      title="Cashflow"
      description="Monthly income vs expense across the workspace, with category breakdowns."
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
            label="Income"
            value={formatINR(totals.income)}
            tone="primary"
          />
          <ReportKpi
            label="Expense"
            value={formatINR(totals.expense)}
            tone="destructive"
          />
          <ReportKpi
            label="Net"
            value={`${totals.net >= 0 ? "+" : "−"}${formatINR(Math.abs(totals.net))}`}
            tone={totals.net >= 0 ? "primary" : "destructive"}
            highlight
          />
          <ReportKpi
            label="Months"
            value={String(series.length)}
            tone="muted"
          />
        </>
      }
      chart={
        <div>
          <h2 className="text-sm font-semibold mb-3">Monthly trend</h2>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="space-y-1.5">
              {series.map((s) => (
                <div
                  key={s.month}
                  className="grid grid-cols-[64px_1fr_88px] items-center gap-3 sm:grid-cols-[72px_1fr_96px]"
                >
                  <div className="text-xs text-muted-foreground tabular-nums">
                    {s.month}
                  </div>
                  <div className="h-6 relative bg-muted rounded-md overflow-hidden">
                    <div
                      className="absolute inset-y-0 left-0 bg-primary/70 transition-all"
                      style={{ width: `${(s.income / maxBar) * 50}%` }}
                    />
                    <div
                      className="absolute inset-y-0 bg-destructive/70 transition-all"
                      style={{
                        left: "50%",
                        width: `${(s.expense / maxBar) * 50}%`,
                      }}
                    />
                    <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
                  </div>
                  <div
                    className={`text-right text-xs font-medium tabular-nums ${s.net >= 0 ? "text-primary" : "text-destructive"}`}
                  >
                    {s.net >= 0 ? "+" : "−"}
                    {formatINR(Math.abs(s.net))}
                  </div>
                </div>
              ))}
              {series.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No data in this range.
                </p>
              )}
            </div>
          )}
        </div>
      }
      exportPayload={buildExport}
    >
      <section>
        <h2 className="text-sm font-semibold mb-2">Monthly detail</h2>
        <SortableTable
          columns={monthCols}
          rows={series}
          rowKey={(r) => r.month}
          defaultSort={{ key: "month", dir: "asc" }}
          totals={{
            month: "Total",
            income: formatINR(totals.income),
            expense: formatINR(totals.expense),
            net: (
              <span
                className={totals.net >= 0 ? "text-primary" : "text-destructive"}
              >
                {totals.net >= 0 ? "+" : "−"}
                {formatINR(Math.abs(totals.net))}
              </span>
            ),
          }}
        />
      </section>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <CategoryList
          title="Top income"
          rows={data?.topIncome ?? []}
          tone="primary"
        />
        <CategoryList
          title="Top expense"
          rows={data?.topExpense ?? []}
          tone="destructive"
        />
      </div>
    </ReportShell>
  );
}

function CategoryList({
  title,
  rows,
  tone,
}: {
  title: string;
  rows: CategoryRow[];
  tone: "primary" | "destructive";
}) {
  const max = Math.max(1, ...rows.map((r) => r.amount));
  const color = tone === "primary" ? "bg-primary" : "bg-destructive";
  return (
    <div className="rounded-xl border bg-card p-5">
      <h3 className="text-sm font-semibold mb-3">{title}</h3>
      {rows.length === 0 ? (
        <div className="text-sm text-muted-foreground">None in this window.</div>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.id}>
              <div className="flex items-center justify-between text-sm">
                <span className="truncate">{r.name}</span>
                <span className="font-medium tabular-nums">
                  {formatINR(r.amount)}
                </span>
              </div>
              <div className="mt-1 h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full ${color}`}
                  style={{ width: `${(r.amount / max) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
