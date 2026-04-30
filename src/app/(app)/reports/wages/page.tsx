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
  active: boolean;
  dailyRate: number | null;
  daysWorked: number;
  earned: number;
  paidFromWages: number;
  advances: number;
  repaid: number;
  bonuses: number;
  balance: number;
};
type Payload = {
  rows: Row[];
  totals: Omit<Row, "id" | "name" | "active" | "dailyRate">;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function WagesReportPage() {
  const [preset, setPreset] = useState<DatePreset>("this-month");
  const [range, setRange] = useState<DateRange>(() => presetRange("this-month"));
  const { data } = useSWR<Payload>(
    `/api/reports/wages?start=${range.start}&end=${range.end}`,
    fetcher,
  );
  const rows = data?.rows ?? [];
  const totals =
    data?.totals ?? {
      daysWorked: 0,
      earned: 0,
      paidFromWages: 0,
      advances: 0,
      repaid: 0,
      bonuses: 0,
      balance: 0,
    };

  const cols: Column<Row>[] = [
    {
      key: "name",
      label: "Worker",
      render: (r) => (
        <div className="min-w-0">
          <Link
            href={`/reports/wages/${r.id}?start=${range.start}&end=${range.end}`}
            className="font-medium hover:underline truncate block"
          >
            {r.name}
          </Link>
          <div className="text-[11px] text-muted-foreground">
            {r.dailyRate != null ? `₹${r.dailyRate}/day` : "no rate"}
            {!r.active ? " · archived" : ""}
            <Link
              href={`/workers/${r.id}`}
              className="ml-1 hover:text-foreground"
            >
              · open profile
            </Link>
          </div>
        </div>
      ),
    },
    {
      key: "daysWorked",
      label: "Days",
      align: "right",
      sortValue: (r) => r.daysWorked,
    },
    {
      key: "earned",
      label: "Earned",
      align: "right",
      render: (r) => formatINR(r.earned),
      sortValue: (r) => r.earned,
    },
    {
      key: "paidFromWages",
      label: "Paid",
      align: "right",
      render: (r) => formatINR(r.paidFromWages),
      sortValue: (r) => r.paidFromWages,
    },
    {
      key: "advances",
      label: "Advances out",
      align: "right",
      render: (r) => formatINR(Math.max(0, r.advances - r.repaid)),
      sortValue: (r) => r.advances - r.repaid,
    },
    {
      key: "bonuses",
      label: "Bonus",
      align: "right",
      render: (r) => formatINR(r.bonuses),
      sortValue: (r) => r.bonuses,
    },
    {
      key: "balance",
      label: "Owed",
      align: "right",
      render: (r) => (
        <span
          className={
            r.balance > 0
              ? "text-primary font-semibold"
              : r.balance < 0
                ? "text-destructive font-semibold"
                : "text-muted-foreground"
          }
        >
          {formatINR(r.balance)}
        </span>
      ),
      sortValue: (r) => r.balance,
    },
  ];

  const buildExport = () => ({
    filename: `wages_${range.start}_${range.end}`,
    sheetName: "Wages",
    title: "Wages & Settlements",
    subtitle: `${range.start} to ${range.end}`,
    columns: [
      { key: "name" as const, label: "Worker", type: "string" as const },
      { key: "active" as const, label: "Active", type: "string" as const },
      { key: "dailyRate" as const, label: "Daily rate", type: "currency" as const },
      { key: "daysWorked" as const, label: "Days worked", type: "number" as const },
      { key: "earned" as const, label: "Earned", type: "currency" as const },
      { key: "paidFromWages" as const, label: "Paid", type: "currency" as const },
      { key: "advances" as const, label: "Advances paid", type: "currency" as const },
      { key: "repaid" as const, label: "Advances returned", type: "currency" as const },
      { key: "bonuses" as const, label: "Bonus", type: "currency" as const },
      { key: "balance" as const, label: "Owed to worker", type: "currency" as const },
    ],
    rows,
    totals: {
      name: "Total",
      daysWorked: totals.daysWorked,
      earned: totals.earned,
      paidFromWages: totals.paidFromWages,
      advances: totals.advances,
      repaid: totals.repaid,
      bonuses: totals.bonuses,
      balance: totals.balance,
    },
  });

  return (
    <ReportShell
      title="Wages & settlements"
      description="Per-worker days worked, earned, paid, advances outstanding, and the running balance owed."
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
            label="Owed to workers"
            value={formatINR(Math.max(0, totals.balance))}
            tone={totals.balance > 0 ? "primary" : "muted"}
            highlight
          />
          <ReportKpi label="Earned" value={formatINR(totals.earned)} tone="muted" />
          <ReportKpi label="Paid" value={formatINR(totals.paidFromWages)} tone="destructive" />
          <ReportKpi
            label="Advances out"
            value={formatINR(Math.max(0, totals.advances - totals.repaid))}
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
        defaultSort={{ key: "balance", dir: "desc" }}
        emptyLabel="No workers in this workspace"
        totals={{
          name: "Total",
          daysWorked: String(totals.daysWorked),
          earned: formatINR(totals.earned),
          paidFromWages: formatINR(totals.paidFromWages),
          advances: formatINR(Math.max(0, totals.advances - totals.repaid)),
          bonuses: formatINR(totals.bonuses),
          balance: formatINR(totals.balance),
        }}
      />
    </ReportShell>
  );
}
