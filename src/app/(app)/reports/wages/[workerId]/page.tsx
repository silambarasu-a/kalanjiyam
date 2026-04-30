"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { ChevronLeft } from "lucide-react";
import { ReportShell, ReportKpi } from "@/components/reports/report-shell";
import {
  ReportFilters,
  presetRange,
  type DatePreset,
  type DateRange,
} from "@/components/reports/report-filters";
import { SortableTable, type Column } from "@/components/reports/sortable-table";
import { formatINR, formatDate } from "@/lib/utils";

type Balance = {
  workerId: string;
  earned: number;
  paidFromWages: number;
  balance: number;
  bonuses: number;
  advances: number;
  repaid: number;
  daysWorked: number;
};
type AttendanceRow = {
  id: string;
  date: string;
  present: boolean;
  mode: string;
  earned: number;
  notes: string | null;
  tagged: string;
};
type PaymentRow = {
  id: string;
  paidAt: string;
  amount: number;
  kind: "WAGE" | "ADVANCE" | "BONUS";
  notes: string | null;
  paidBy: string | null;
};
type RepaymentRow = {
  id: string;
  receivedAt: string;
  amount: number;
  reversed: boolean;
  reason: string | null;
  notes: string | null;
  receivedBy: string | null;
};
type SettlementRow = {
  id: string;
  periodStart: string;
  periodEnd: string;
  cadence: string;
  earnedAmount: number;
  paidAmount: number;
  amountDue: number;
  status: string;
  settledAt: string | null;
};
type Payload = {
  worker: {
    id: string;
    name: string;
    phone: string | null;
    dailyRate: number | null;
    settlementCadence: string;
    active: boolean;
  };
  balance: Balance;
  attendance: AttendanceRow[];
  payments: PaymentRow[];
  repayments: RepaymentRow[];
  settlements: SettlementRow[];
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function WorkerWagesReportPage() {
  const params = useParams<{ workerId: string }>();
  const workerId = params?.workerId;
  const search = useSearchParams();
  const initialStart = search?.get("start");
  const initialEnd = search?.get("end");
  const [preset, setPreset] = useState<DatePreset>(
    initialStart && initialEnd ? "custom" : "this-month",
  );
  const [range, setRange] = useState<DateRange>(() =>
    initialStart && initialEnd
      ? { start: initialStart, end: initialEnd }
      : presetRange("this-month"),
  );
  const { data, error } = useSWR<Payload>(
    workerId
      ? `/api/reports/wages/${workerId}?start=${range.start}&end=${range.end}`
      : null,
    fetcher,
  );

  if (error) {
    return (
      <div className="space-y-2">
        <Link href="/reports/wages" className="text-xs text-muted-foreground inline-flex items-center gap-1">
          <ChevronLeft className="h-3 w-3" /> Wages report
        </Link>
        <p className="text-sm text-destructive">Could not load this worker.</p>
      </div>
    );
  }

  const balance =
    data?.balance ?? {
      workerId: workerId ?? "",
      earned: 0,
      paidFromWages: 0,
      balance: 0,
      bonuses: 0,
      advances: 0,
      repaid: 0,
      daysWorked: 0,
    };
  const attendance = data?.attendance ?? [];
  const payments = data?.payments ?? [];
  const repayments = data?.repayments ?? [];
  const settlements = data?.settlements ?? [];

  const attendanceCols: Column<AttendanceRow>[] = [
    {
      key: "date",
      label: "Date",
      render: (r) => formatDate(r.date),
      sortValue: (r) => r.date,
    },
    {
      key: "present",
      label: "Status",
      render: (r) => (
        <span className={r.present ? "text-primary" : "text-muted-foreground"}>
          {r.present ? "Present" : "Absent"}
        </span>
      ),
    },
    { key: "mode", label: "Rate basis" },
    { key: "tagged", label: "Tagged to" },
    {
      key: "earned",
      label: "Earned",
      align: "right",
      render: (r) => (r.present ? formatINR(r.earned) : "—"),
      sortValue: (r) => r.earned,
    },
    { key: "notes", label: "Notes" },
  ];

  const paymentCols: Column<PaymentRow>[] = [
    {
      key: "paidAt",
      label: "Date",
      render: (r) => formatDate(r.paidAt),
      sortValue: (r) => r.paidAt,
    },
    {
      key: "kind",
      label: "Kind",
      render: (r) => (
        <span
          className={
            r.kind === "BONUS"
              ? "text-primary"
              : r.kind === "ADVANCE"
                ? "text-amber-700 dark:text-amber-400"
                : ""
          }
        >
          {r.kind}
        </span>
      ),
    },
    {
      key: "amount",
      label: "Amount",
      align: "right",
      render: (r) => formatINR(r.amount),
      sortValue: (r) => r.amount,
    },
    { key: "paidBy", label: "Paid by" },
    { key: "notes", label: "Notes" },
  ];

  const repaymentCols: Column<RepaymentRow>[] = [
    {
      key: "receivedAt",
      label: "Date",
      render: (r) => formatDate(r.receivedAt),
      sortValue: (r) => r.receivedAt,
    },
    {
      key: "amount",
      label: "Amount",
      align: "right",
      render: (r) => (
        <span className={r.reversed ? "line-through text-muted-foreground" : ""}>
          {formatINR(r.amount)}
        </span>
      ),
      sortValue: (r) => r.amount,
    },
    {
      key: "reversed",
      label: "Status",
      render: (r) =>
        r.reversed ? (
          <span className="text-destructive">Reversed{r.reason ? ` · ${r.reason}` : ""}</span>
        ) : (
          <span className="text-primary">Active</span>
        ),
    },
    { key: "receivedBy", label: "Received by" },
    { key: "notes", label: "Notes" },
  ];

  const settlementCols: Column<SettlementRow>[] = [
    {
      key: "periodStart",
      label: "Period",
      render: (r) => `${formatDate(r.periodStart)} → ${formatDate(r.periodEnd)}`,
      sortValue: (r) => r.periodStart,
    },
    { key: "cadence", label: "Cadence" },
    {
      key: "earnedAmount",
      label: "Earned",
      align: "right",
      render: (r) => formatINR(r.earnedAmount),
      sortValue: (r) => r.earnedAmount,
    },
    {
      key: "paidAmount",
      label: "Paid",
      align: "right",
      render: (r) => formatINR(r.paidAmount),
      sortValue: (r) => r.paidAmount,
    },
    {
      key: "amountDue",
      label: "Due",
      align: "right",
      render: (r) => (
        <span
          className={
            r.amountDue > 0 ? "text-primary font-semibold" : "text-muted-foreground"
          }
        >
          {formatINR(r.amountDue)}
        </span>
      ),
      sortValue: (r) => r.amountDue,
    },
    {
      key: "status",
      label: "Status",
      render: (r) => (
        <span
          className={
            r.status === "SETTLED"
              ? "text-primary"
              : r.status === "CANCELLED"
                ? "text-muted-foreground"
                : ""
          }
        >
          {r.status}
        </span>
      ),
    },
  ];

  // Build a flat export combining all sections — one row per data point, with
  // a "section" column so the user can pivot in Excel. Plus per-section CSV
  // would be cleaner; for one-click export we use the flat shape.
  const buildExport = () => {
    const flat: Array<{
      section: string;
      date: string;
      kind: string;
      detail: string;
      amount: number | null;
      notes: string | null;
    }> = [];
    for (const a of attendance) {
      flat.push({
        section: "Attendance",
        date: a.date.slice(0, 10),
        kind: a.present ? "Present" : "Absent",
        detail: a.tagged ? `${a.mode} · ${a.tagged}` : a.mode,
        amount: a.present ? a.earned : null,
        notes: a.notes,
      });
    }
    for (const p of payments) {
      flat.push({
        section: "Payments",
        date: p.paidAt.slice(0, 10),
        kind: p.kind,
        detail: p.paidBy ?? "",
        amount: p.amount,
        notes: p.notes,
      });
    }
    for (const r of repayments) {
      flat.push({
        section: "Advance returns",
        date: r.receivedAt.slice(0, 10),
        kind: r.reversed ? "REVERSED" : "RECEIVED",
        detail: r.receivedBy ?? "",
        amount: r.amount,
        notes: r.notes ?? r.reason,
      });
    }
    for (const s of settlements) {
      flat.push({
        section: "Settlements",
        date: s.periodEnd.slice(0, 10),
        kind: s.status,
        detail: `${s.periodStart.slice(0, 10)} → ${s.periodEnd.slice(0, 10)} (${s.cadence})`,
        amount: s.amountDue,
        notes: null,
      });
    }
    return {
      filename: `wages_${data?.worker.name.replace(/\s+/g, "_") ?? "worker"}_${range.start}_${range.end}`,
      sheetName: data?.worker.name ?? "Worker",
      title: `Wages — ${data?.worker.name ?? ""}`,
      subtitle: `${range.start} to ${range.end}`,
      columns: [
        { key: "section" as const, label: "Section", type: "string" as const },
        { key: "date" as const, label: "Date", type: "date" as const },
        { key: "kind" as const, label: "Kind", type: "string" as const },
        { key: "detail" as const, label: "Detail", type: "string" as const },
        { key: "amount" as const, label: "Amount", type: "currency" as const },
        { key: "notes" as const, label: "Notes", type: "string" as const },
      ],
      rows: flat,
      totals: {
        section: "Earned (window)",
        amount: balance.earned,
      },
    };
  };

  return (
    <ReportShell
      title={data ? `${data.worker.name} — Wages` : "Worker wages"}
      description={
        data
          ? `${data.worker.dailyRate != null ? `₹${data.worker.dailyRate}/day` : "no rate"} · ${data.worker.settlementCadence}${data.worker.phone ? ` · ${data.worker.phone}` : ""}`
          : "Loading…"
      }
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
            label="Owed"
            value={formatINR(balance.balance)}
            tone={
              balance.balance > 0
                ? "primary"
                : balance.balance < 0
                  ? "destructive"
                  : "muted"
            }
            highlight
          />
          <ReportKpi
            label="Days worked"
            value={String(balance.daysWorked)}
            tone="muted"
          />
          <ReportKpi label="Earned" value={formatINR(balance.earned)} tone="muted" />
          <ReportKpi
            label="Paid (net)"
            value={formatINR(balance.paidFromWages)}
            tone="destructive"
            hint={
              balance.repaid > 0
                ? `${formatINR(balance.repaid)} returned`
                : undefined
            }
          />
        </>
      }
      exportPayload={buildExport}
    >
      <div className="no-print">
        <Link
          href={`/reports/wages?start=${range.start}&end=${range.end}`}
          className="text-xs text-muted-foreground inline-flex items-center gap-1 hover:text-foreground"
        >
          <ChevronLeft className="h-3 w-3" /> All workers
        </Link>
      </div>

      <section>
        <h2 className="text-sm font-semibold mb-2">Attendance</h2>
        <SortableTable
          columns={attendanceCols}
          rows={attendance}
          rowKey={(r) => r.id}
          defaultSort={{ key: "date", dir: "desc" }}
          emptyLabel="No attendance in this window"
          totals={{
            date: "Total",
            earned: formatINR(balance.earned),
          }}
        />
      </section>

      <section>
        <h2 className="text-sm font-semibold mb-2">Payments</h2>
        <SortableTable
          columns={paymentCols}
          rows={payments}
          rowKey={(r) => r.id}
          defaultSort={{ key: "paidAt", dir: "desc" }}
          emptyLabel="No payments in this window"
          totals={{
            paidAt: "Total paid",
            amount: formatINR(payments.reduce((s, p) => s + p.amount, 0)),
          }}
        />
      </section>

      {repayments.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-2">Advance returns</h2>
          <SortableTable
            columns={repaymentCols}
            rows={repayments}
            rowKey={(r) => r.id}
            defaultSort={{ key: "receivedAt", dir: "desc" }}
            emptyLabel="No advance returns"
            totals={{
              receivedAt: "Total returned",
              amount: formatINR(
                repayments.filter((r) => !r.reversed).reduce((s, r) => s + r.amount, 0),
              ),
            }}
          />
        </section>
      )}

      {settlements.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-2">Settlements</h2>
          <SortableTable
            columns={settlementCols}
            rows={settlements}
            rowKey={(r) => r.id}
            defaultSort={{ key: "periodStart", dir: "desc" }}
            emptyLabel="No settlements"
          />
        </section>
      )}
    </ReportShell>
  );
}
