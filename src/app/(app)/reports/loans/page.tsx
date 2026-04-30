"use client";

import Link from "next/link";
import useSWR from "swr";
import { ReportShell, ReportKpi } from "@/components/reports/report-shell";
import { SortableTable, type Column } from "@/components/reports/sortable-table";
import { formatINR, formatDate } from "@/lib/utils";

type LoanRow = {
  id: string;
  kind: string;
  source: "BANK" | "HAND_FORMAL" | "CARD_EMI";
  lender: string;
  principal: number;
  outstanding: number;
  emiAmount: number | null;
  interestRate: number | null;
  frequency: string;
  startedAt: string;
  maturityAt: string | null;
  nextDueDate: string | null;
  active: boolean;
  foreclosedAt: string | null;
  totalPaid: number;
  paidPrincipal: number;
  paidInterest: number;
  progressPct: number;
};
type Payload = {
  active: LoanRow[];
  closed: LoanRow[];
  totals: {
    principal: number;
    outstanding: number;
    paidPrincipal: number;
    paidInterest: number;
    totalPaid: number;
    activeCount: number;
    closedCount: number;
  };
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function LoansReportPage() {
  const { data } = useSWR<Payload>("/api/reports/loans", fetcher);
  const totals = data?.totals ?? {
    principal: 0,
    outstanding: 0,
    paidPrincipal: 0,
    paidInterest: 0,
    totalPaid: 0,
    activeCount: 0,
    closedCount: 0,
  };

  const cols: Column<LoanRow>[] = [
    {
      key: "lender",
      label: "Lender",
      render: (r) => (
        <div className="min-w-0">
          <Link
            href={`/loans/${r.id}`}
            className="font-medium hover:underline truncate block"
          >
            {r.lender}
          </Link>
          <div className="text-[11px] text-muted-foreground">
            {r.source} · {r.kind}
          </div>
        </div>
      ),
    },
    {
      key: "principal",
      label: "Principal",
      align: "right",
      render: (r) => formatINR(r.principal),
      sortValue: (r) => r.principal,
    },
    {
      key: "outstanding",
      label: "Outstanding",
      align: "right",
      render: (r) => (
        <span
          className={r.outstanding > 0 ? "text-destructive font-semibold" : "text-primary"}
        >
          {formatINR(r.outstanding)}
        </span>
      ),
      sortValue: (r) => r.outstanding,
    },
    {
      key: "totalPaid",
      label: "Paid",
      align: "right",
      render: (r) => formatINR(r.totalPaid),
      sortValue: (r) => r.totalPaid,
    },
    {
      key: "progressPct",
      label: "Progress",
      align: "right",
      render: (r) => (
        <div className="inline-flex items-center gap-2">
          <div className="h-1.5 w-20 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary"
              style={{ width: `${r.progressPct}%` }}
            />
          </div>
          <span className="text-xs">{r.progressPct.toFixed(0)}%</span>
        </div>
      ),
      sortValue: (r) => r.progressPct,
    },
    {
      key: "emiAmount",
      label: "EMI",
      align: "right",
      render: (r) => (r.emiAmount == null ? "—" : formatINR(r.emiAmount)),
      sortValue: (r) => r.emiAmount ?? 0,
    },
    {
      key: "nextDueDate",
      label: "Next due",
      render: (r) => (r.nextDueDate ? formatDate(r.nextDueDate) : "—"),
      sortValue: (r) => r.nextDueDate ?? "",
    },
  ];

  const buildExport = () => ({
    filename: "loan_portfolio",
    sheetName: "Loans",
    title: "Loan Portfolio",
    subtitle: `${totals.activeCount} active · ${totals.closedCount} closed`,
    columns: [
      { key: "lender" as const, label: "Lender", type: "string" as const },
      { key: "kind" as const, label: "Kind", type: "string" as const },
      { key: "source" as const, label: "Source", type: "string" as const },
      { key: "principal" as const, label: "Principal", type: "currency" as const },
      { key: "outstanding" as const, label: "Outstanding", type: "currency" as const },
      { key: "totalPaid" as const, label: "Total paid", type: "currency" as const },
      { key: "paidPrincipal" as const, label: "Paid principal", type: "currency" as const },
      { key: "paidInterest" as const, label: "Paid interest", type: "currency" as const },
      { key: "emiAmount" as const, label: "EMI", type: "currency" as const },
      { key: "interestRate" as const, label: "Rate %", type: "number" as const },
      { key: "frequency" as const, label: "Frequency", type: "string" as const },
      { key: "startedAt" as const, label: "Started", type: "date" as const },
      { key: "maturityAt" as const, label: "Maturity", type: "date" as const },
      { key: "nextDueDate" as const, label: "Next due", type: "date" as const },
      { key: "active" as const, label: "Active", type: "string" as const },
    ],
    rows: [...(data?.active ?? []), ...(data?.closed ?? [])],
    totals: {
      lender: "Total (active)",
      principal: totals.principal,
      outstanding: totals.outstanding,
      totalPaid: totals.totalPaid,
      paidPrincipal: totals.paidPrincipal,
      paidInterest: totals.paidInterest,
    },
  });

  return (
    <ReportShell
      title="Loan portfolio"
      description="All loans with their outstanding, EMI, and lifetime payment summary. Click a lender to drill into the loan."
      kpis={
        <>
          <ReportKpi
            label="Outstanding"
            value={formatINR(totals.outstanding)}
            tone="destructive"
            highlight
          />
          <ReportKpi label="Principal" value={formatINR(totals.principal)} tone="muted" />
          <ReportKpi label="Total paid" value={formatINR(totals.totalPaid)} tone="primary" />
          <ReportKpi
            label="Loans"
            value={`${totals.activeCount} active`}
            hint={`${totals.closedCount} closed`}
            tone="muted"
          />
        </>
      }
      exportPayload={buildExport}
    >
      <section>
        <h2 className="text-sm font-semibold mb-2">Active</h2>
        <SortableTable
          columns={cols}
          rows={data?.active ?? []}
          rowKey={(r) => r.id}
          defaultSort={{ key: "outstanding", dir: "desc" }}
          emptyLabel="No active loans"
          totals={{
            lender: "Total",
            principal: formatINR(totals.principal),
            outstanding: formatINR(totals.outstanding),
            totalPaid: formatINR(totals.totalPaid),
          }}
        />
      </section>
      {data && data.closed.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-2">Closed</h2>
          <SortableTable
            columns={cols}
            rows={data.closed}
            rowKey={(r) => r.id}
            defaultSort={{ key: "startedAt", dir: "desc" }}
            emptyLabel="No closed loans"
          />
        </section>
      )}
    </ReportShell>
  );
}
