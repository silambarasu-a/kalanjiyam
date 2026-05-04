"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { ReportShell, ReportKpi } from "@/components/reports/report-shell";
import { SortableTable, type Column } from "@/components/reports/sortable-table";
import { cn, formatINR } from "@/lib/utils";

type Snap = {
  month: string;
  liquid: number;
  invested: number;
  cards: number;
  loans: number;
  assets: number;
  liabilities: number;
  net: number;
};
type Payload = {
  months: number;
  series: Snap[];
  latest: Snap | null;
  change: number;
  changePct: number;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function NetWorthReportPage() {
  const [months, setMonths] = useState(12);
  const { data } = useSWR<Payload>(
    `/api/reports/net-worth?months=${months}`,
    fetcher,
  );

  const series = useMemo(() => data?.series ?? [], [data?.series]);
  const latest = data?.latest;
  const max = useMemo(
    () => Math.max(1, ...series.map((s) => Math.max(s.assets, s.liabilities))),
    [series],
  );

  const cols: Column<Snap>[] = [
    { key: "month", label: "Month" },
    {
      key: "liquid",
      label: "Liquid",
      align: "right",
      render: (r) => formatINR(r.liquid),
      sortValue: (r) => r.liquid,
    },
    {
      key: "invested",
      label: "Invested",
      align: "right",
      render: (r) => formatINR(r.invested),
      sortValue: (r) => r.invested,
    },
    {
      key: "cards",
      label: "Card debt",
      align: "right",
      render: (r) => formatINR(r.cards),
      sortValue: (r) => r.cards,
    },
    {
      key: "loans",
      label: "Loans",
      align: "right",
      render: (r) => formatINR(r.loans),
      sortValue: (r) => r.loans,
    },
    {
      key: "net",
      label: "Net worth",
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
    filename: `net_worth_${months}m`,
    sheetName: "Net worth",
    title: "Net Worth Trend",
    subtitle: `Last ${months} months`,
    columns: [
      { key: "month" as const, label: "Month", type: "string" as const },
      { key: "liquid" as const, label: "Liquid", type: "currency" as const },
      { key: "invested" as const, label: "Invested", type: "currency" as const },
      { key: "cards" as const, label: "Card debt", type: "currency" as const },
      { key: "loans" as const, label: "Loans", type: "currency" as const },
      { key: "assets" as const, label: "Assets", type: "currency" as const },
      { key: "liabilities" as const, label: "Liabilities", type: "currency" as const },
      { key: "net" as const, label: "Net worth", type: "currency" as const },
    ],
    rows: series,
  });

  return (
    <ReportShell
      title="Net worth trend"
      description="Monthly assets minus liabilities. Investments use current value where set, otherwise cost basis. Loan outstanding is point-in-time approximate."
      filters={
        <div className="rounded-xl border bg-card px-3 py-3 sm:px-4 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Window</span>
          {[6, 12, 24, 36].map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMonths(m)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                months === m
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {m} months
            </button>
          ))}
        </div>
      }
      kpis={
        <>
          <ReportKpi
            label="Net worth"
            value={
              latest
                ? `${latest.net >= 0 ? "+" : "−"}${formatINR(Math.abs(latest.net))}`
                : "—"
            }
            tone={latest && latest.net >= 0 ? "primary" : "destructive"}
            highlight
          />
          <ReportKpi
            label="Assets"
            value={latest ? formatINR(latest.assets) : "—"}
            tone="primary"
          />
          <ReportKpi
            label="Liabilities"
            value={latest ? formatINR(latest.liabilities) : "—"}
            tone="destructive"
          />
          <ReportKpi
            label={`Δ over ${months}m`}
            value={
              data
                ? `${data.change >= 0 ? "+" : "−"}${formatINR(Math.abs(data.change))}`
                : "—"
            }
            hint={data ? `${data.changePct >= 0 ? "+" : ""}${data.changePct.toFixed(1)}%` : undefined}
            tone={data && data.change >= 0 ? "primary" : "destructive"}
          />
        </>
      }
      chart={
        <div>
          <h2 className="text-sm font-semibold mb-3">Trend</h2>
          <div className="space-y-1.5">
            {series.map((s) => (
              <div
                key={s.month}
                className="grid grid-cols-[64px_1fr_88px] items-center gap-3 sm:grid-cols-[72px_1fr_120px]"
              >
                <div className="text-xs text-muted-foreground tabular-nums">
                  {s.month}
                </div>
                <div className="h-6 relative bg-muted rounded-md overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 bg-primary/70 transition-all"
                    style={{ width: `${(s.assets / max) * 50}%` }}
                  />
                  <div
                    className="absolute inset-y-0 bg-destructive/70 transition-all"
                    style={{
                      left: "50%",
                      width: `${(s.liabilities / max) * 50}%`,
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
          </div>
        </div>
      }
      exportPayload={buildExport}
    >
      <SortableTable
        columns={cols}
        rows={series}
        rowKey={(r) => r.month}
        defaultSort={{ key: "month", dir: "asc" }}
        emptyLabel="No data in this window"
      />
    </ReportShell>
  );
}
