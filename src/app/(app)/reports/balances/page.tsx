"use client";

import { useState } from "react";
import useSWR from "swr";
import { ReportShell, ReportKpi } from "@/components/reports/report-shell";
import { SortableTable, type Column } from "@/components/reports/sortable-table";
import { DateInput } from "@/components/ui/date-input";
import { formatINR } from "@/lib/utils";

type Row = {
  id: string;
  name: string;
  kind: "BANK" | "CASH" | "CARD" | "WALLET";
  openingBalance: number;
  income: number;
  expense: number;
  transfersIn: number;
  transfersOut: number;
  balance: number;
  creditLimit: number | null;
};
type Payload = {
  asOf: string;
  accounts: Row[];
  totals: { assets: number; liabilities: number; net: number };
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function AccountBalancesReportPage() {
  const today = new Date().toISOString().slice(0, 10);
  const [asOf, setAsOf] = useState(today);
  const { data } = useSWR<Payload>(`/api/reports/balances?asOf=${asOf}`, fetcher);

  const totals = data?.totals ?? { assets: 0, liabilities: 0, net: 0 };
  const accounts = data?.accounts ?? [];

  const cols: Column<Row>[] = [
    { key: "name", label: "Account" },
    { key: "kind", label: "Kind" },
    {
      key: "openingBalance",
      label: "Opening",
      align: "right",
      render: (r) => formatINR(r.openingBalance),
      sortValue: (r) => r.openingBalance,
    },
    {
      key: "income",
      label: "Inflow",
      align: "right",
      render: (r) => formatINR(r.income + r.transfersIn),
      sortValue: (r) => r.income + r.transfersIn,
    },
    {
      key: "expense",
      label: "Outflow",
      align: "right",
      render: (r) => formatINR(r.expense + r.transfersOut),
      sortValue: (r) => r.expense + r.transfersOut,
    },
    {
      key: "balance",
      label: "Balance",
      align: "right",
      render: (r) => (
        <span
          className={
            r.kind === "CARD"
              ? r.balance > 0
                ? "text-destructive font-semibold"
                : ""
              : r.balance >= 0
                ? "text-primary font-semibold"
                : "text-destructive font-semibold"
          }
        >
          {formatINR(r.balance)}
        </span>
      ),
      sortValue: (r) => r.balance,
    },
  ];

  const buildExport = () => ({
    filename: `account_balances_${asOf}`,
    sheetName: "Balances",
    title: "Account Balances",
    subtitle: `As of ${asOf}`,
    columns: [
      { key: "name" as const, label: "Account", type: "string" as const },
      { key: "kind" as const, label: "Kind", type: "string" as const },
      { key: "openingBalance" as const, label: "Opening", type: "currency" as const },
      { key: "income" as const, label: "Income", type: "currency" as const },
      { key: "expense" as const, label: "Expense", type: "currency" as const },
      { key: "transfersIn" as const, label: "Transfers in", type: "currency" as const },
      { key: "transfersOut" as const, label: "Transfers out", type: "currency" as const },
      { key: "balance" as const, label: "Balance", type: "currency" as const },
    ],
    rows: accounts,
    totals: {
      name: "Total",
      kind: "",
      openingBalance: accounts.reduce((s, r) => s + r.openingBalance, 0),
      income: accounts.reduce((s, r) => s + r.income, 0),
      expense: accounts.reduce((s, r) => s + r.expense, 0),
      transfersIn: accounts.reduce((s, r) => s + r.transfersIn, 0),
      transfersOut: accounts.reduce((s, r) => s + r.transfersOut, 0),
      balance: totals.net,
    },
  });

  return (
    <ReportShell
      title="Account balances"
      description="Snapshot of every account's running balance at a chosen date."
      filters={
        <div className="rounded-xl border bg-card px-3 py-3 sm:px-4 flex flex-wrap items-center gap-3">
          <span className="text-xs font-medium text-muted-foreground">As of</span>
          <DateInput
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
            className="h-8 w-40"
          />
        </div>
      }
      kpis={
        <>
          <ReportKpi
            label="Liquid assets"
            value={formatINR(totals.assets)}
            tone="primary"
          />
          <ReportKpi
            label="Card liabilities"
            value={formatINR(totals.liabilities)}
            tone="destructive"
          />
          <ReportKpi
            label="Net position"
            value={`${totals.net >= 0 ? "+" : "−"}${formatINR(Math.abs(totals.net))}`}
            tone={totals.net >= 0 ? "primary" : "destructive"}
            highlight
          />
          <ReportKpi
            label="Accounts"
            value={String(accounts.length)}
            tone="muted"
          />
        </>
      }
      exportPayload={buildExport}
    >
      <SortableTable
        columns={cols}
        rows={accounts}
        rowKey={(r) => r.id}
        defaultSort={{ key: "balance", dir: "desc" }}
        emptyLabel="No accounts in this workspace"
      />
    </ReportShell>
  );
}
