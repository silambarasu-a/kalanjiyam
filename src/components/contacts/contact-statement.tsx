"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Download, FileSpreadsheet, Printer } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ReportKpi } from "@/components/reports/report-shell";
import {
  ReportFilters,
  presetRange,
  type DatePreset,
  type DateRange,
} from "@/components/reports/report-filters";
import {
  downloadCSV,
  downloadExcel,
  printReport,
  type ExportColumn,
} from "@/lib/report-export";
import { ContactFlowChart, type FlowBucket } from "@/components/contacts/contact-flow-chart";
import { formatINR, formatDate } from "@/lib/utils";
import { fetcher } from "@/lib/swr-fetcher";

type EventGroup = "CASH" | "ACCRUAL" | "INFO" | "LOAN";
type Direction = "IN" | "OUT" | "NEUTRAL";

type StatementEvent = {
  id: string;
  date: string;
  type: string;
  group: EventGroup;
  label: string;
  description: string;
  account: string | null;
  amount: number;
  direction: Direction;
  cashDelta: number;
  runningCash: number;
  transactionId: string | null;
  loanId: string | null;
};

type Statement = {
  contact: { id: string; name: string; relationship: string | null };
  range: { from: string | null; to: string | null };
  summary: {
    received: number;
    paid: number;
    netCash: number;
    openingNetCash: number;
    closingNetCash: number;
    theyOweYou: number;
    youOweThem: number;
    theyOweYouAdded: number;
    youOweThemAdded: number;
    settledInPeriod: number;
    spentOnThemInPeriod: number;
    eventCount: number;
  };
  monthly: FlowBucket[];
  events: StatementEvent[];
};

type ExportRow = {
  date: string;
  type: string;
  description: string;
  account: string;
  moneyIn: number | "";
  moneyOut: number | "";
  amount: number;
  balance: number;
};

const NEUTRAL_TAG: Record<string, string> = {
  CHARGE_OWED_TO_USER: "owed to you",
  CHARGE_USER_OWES: "you owe",
  SPENT_ON_THEM: "spent on them",
  THEY_PAID: "they paid",
  LOAN: "principal",
};

function badgeClass(e: StatementEvent): string {
  if (e.group === "CASH")
    return e.direction === "IN"
      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
      : "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400";
  if (e.group === "ACCRUAL")
    return "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400";
  if (e.group === "LOAN")
    return "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-400";
  return "bg-muted text-muted-foreground";
}

export function ContactStatement({
  contactId,
  contactName,
  onViewTransaction,
}: {
  contactId: string;
  contactName: string;
  onViewTransaction?: (transactionId: string) => void;
}) {
  const [preset, setPreset] = useState<DatePreset>("last-12m");
  const [range, setRange] = useState<DateRange>(() => presetRange("last-12m"));

  const url = `/api/contacts/${contactId}/statement?from=${range.start}&to=${range.end}`;
  const { data, isLoading } = useSWR<Statement>(url, fetcher);

  const s = data?.summary;
  const events = data?.events ?? [];
  const monthly = data?.monthly ?? [];

  const netOutstanding = (s?.theyOweYou ?? 0) - (s?.youOweThem ?? 0);

  const rangeLabel = useMemo(() => {
    try {
      const opts: Intl.DateTimeFormatOptions = {
        day: "numeric",
        month: "short",
        year: "numeric",
      };
      return `${new Date(range.start).toLocaleDateString("en-IN", opts)} – ${new Date(
        range.end,
      ).toLocaleDateString("en-IN", opts)}`;
    } catch {
      return "";
    }
  }, [range]);

  function buildExport() {
    const columns: ExportColumn<ExportRow>[] = [
      { key: "date", label: "Date", type: "date" },
      { key: "type", label: "Type", type: "string" },
      { key: "description", label: "Description", type: "string" },
      { key: "account", label: "Account", type: "string" },
      { key: "moneyIn", label: "Money in", type: "currency" },
      { key: "moneyOut", label: "Money out", type: "currency" },
      { key: "amount", label: "Amount", type: "currency" },
      { key: "balance", label: "Cash balance", type: "currency" },
    ];
    // Export in chronological order (oldest first) — the natural reading
    // order for a statement with a running balance.
    const rows: ExportRow[] = events
      .slice()
      .reverse()
      .map((e) => ({
        date: e.date,
        type: e.label,
        description: e.description,
        account: e.account ?? "",
        moneyIn: e.direction === "IN" ? e.amount : "",
        moneyOut: e.direction === "OUT" ? e.amount : "",
        amount: e.amount,
        balance: e.runningCash,
      }));
    return {
      filename: `statement_${contactName.replace(/\s+/g, "_").toLowerCase()}`,
      sheetName: "Statement",
      title: `Statement — ${contactName}`,
      subtitle: rangeLabel,
      columns,
      rows,
      totals: {
        type: "Total",
        moneyIn: s?.received ?? 0,
        moneyOut: s?.paid ?? 0,
        balance: s?.closingNetCash ?? 0,
      } as Partial<Record<keyof ExportRow, number | string>>,
    };
  }

  return (
    <div className="space-y-4 print-container">
      {/* Filters + export — hidden when printing. */}
      <div className="no-print flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <ReportFilters
          preset={preset}
          onPresetChange={setPreset}
          range={range}
          onRangeChange={setRange}
          presets={[
            "last-12m",
            "this-month",
            "last-month",
            "this-quarter",
            "this-year",
            "fy-current",
            "custom",
          ]}
        />
        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors">
            <Download className="h-3.5 w-3.5" /> Export
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={() => downloadCSV(buildExport())}>
              <FileSpreadsheet className="h-3.5 w-3.5" /> CSV
            </DropdownMenuItem>
            <DropdownMenuItem onClick={async () => await downloadExcel(buildExport())}>
              <FileSpreadsheet className="h-3.5 w-3.5" /> Excel (.xlsx)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTimeout(printReport, 80)}>
              <Printer className="h-3.5 w-3.5" /> Print / PDF
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Print-only header. */}
      <div className="hidden print:block">
        <h2 className="text-lg font-semibold">Statement — {contactName}</h2>
        <p className="text-xs text-muted-foreground">{rangeLabel}</p>
      </div>

      {/* KPIs. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <ReportKpi
          label="Received"
          value={formatINR(s?.received ?? 0)}
          tone="primary"
          hint={`in ${rangeLabel}`}
        />
        <ReportKpi
          label="Paid / sent"
          value={formatINR(s?.paid ?? 0)}
          tone="destructive"
          hint={`in ${rangeLabel}`}
        />
        <ReportKpi
          label="Net for period"
          value={`${(s?.netCash ?? 0) >= 0 ? "+" : "−"}${formatINR(Math.abs(s?.netCash ?? 0))}`}
          tone={(s?.netCash ?? 0) >= 0 ? "primary" : "destructive"}
          hint={(s?.netCash ?? 0) >= 0 ? "net received" : "net paid out"}
          highlight
        />
        <ReportKpi
          label={
            netOutstanding > 0
              ? "They owe you"
              : netOutstanding < 0
                ? "You owe them"
                : "Settled up"
          }
          value={formatINR(Math.abs(netOutstanding))}
          tone={netOutstanding > 0 ? "default" : netOutstanding < 0 ? "destructive" : "muted"}
          hint="standing balance (now)"
          highlight={netOutstanding !== 0}
        />
      </div>

      {/* Chart. */}
      <div className="rounded-xl border bg-card p-4 sm:p-5">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold">Monthly cash flow with {contactName}</h3>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            Opening {formatINR(s?.openingNetCash ?? 0)} · Closing{" "}
            {formatINR(s?.closingNetCash ?? 0)}
          </span>
        </div>
        <ContactFlowChart data={monthly} />
      </div>

      {/* Statement table. */}
      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="whitespace-nowrap">Date</TableHead>
              <TableHead>Activity</TableHead>
              <TableHead className="text-right whitespace-nowrap">Money in</TableHead>
              <TableHead className="text-right whitespace-nowrap">Money out</TableHead>
              <TableHead className="text-right whitespace-nowrap">Cash balance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.map((e) => {
              const clickable = !!e.transactionId && !!onViewTransaction;
              return (
                <TableRow key={e.id}>
                  <TableCell className="whitespace-nowrap align-top text-xs text-muted-foreground tabular-nums">
                    {formatDate(e.date)}
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${badgeClass(
                          e,
                        )}`}
                      >
                        {e.label}
                      </span>
                      {clickable ? (
                        <button
                          type="button"
                          onClick={() => onViewTransaction?.(e.transactionId!)}
                          className="text-left text-sm font-medium hover:underline"
                          title="View full transaction details"
                        >
                          {e.description}
                        </button>
                      ) : e.loanId ? (
                        <Link
                          href={`/loans/${e.loanId}`}
                          className="text-sm font-medium hover:underline"
                        >
                          {e.description}
                        </Link>
                      ) : (
                        <span className="text-sm font-medium">{e.description}</span>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {e.account ? <span>{e.account}</span> : null}
                      {e.direction === "NEUTRAL" && (
                        <span>
                          {e.account ? " · " : ""}
                          {formatINR(e.amount)} {NEUTRAL_TAG[e.type] ?? ""}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right align-top tabular-nums text-sm text-emerald-700 dark:text-emerald-400">
                    {e.direction === "IN" ? formatINR(e.amount) : ""}
                  </TableCell>
                  <TableCell className="text-right align-top tabular-nums text-sm text-destructive">
                    {e.direction === "OUT" ? formatINR(e.amount) : ""}
                  </TableCell>
                  <TableCell className="text-right align-top tabular-nums text-sm text-muted-foreground">
                    {formatINR(e.runningCash)}
                  </TableCell>
                </TableRow>
              );
            })}
            {events.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                  {isLoading
                    ? "Loading…"
                    : "No activity with this contact in this period."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
          {events.length > 0 && (
            <TableFooter>
              <TableRow>
                <TableCell />
                <TableCell className="text-xs font-medium text-muted-foreground">
                  {s?.eventCount ?? events.length} item
                  {(s?.eventCount ?? events.length) === 1 ? "" : "s"} · Opening{" "}
                  {formatINR(s?.openingNetCash ?? 0)}
                </TableCell>
                <TableCell className="text-right tabular-nums font-semibold text-emerald-700 dark:text-emerald-400">
                  {formatINR(s?.received ?? 0)}
                </TableCell>
                <TableCell className="text-right tabular-nums font-semibold text-destructive">
                  {formatINR(s?.paid ?? 0)}
                </TableCell>
                <TableCell className="text-right tabular-nums font-semibold">
                  {formatINR(s?.closingNetCash ?? 0)}
                </TableCell>
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </div>

      <p className="text-[11px] text-muted-foreground no-print">
        &ldquo;Cash balance&rdquo; is the running net of money exchanged with {contactName}
        {" "}(received − paid) within the selected window. Charges are obligations booked
        without cash moving; spent-on-them and gifts are informational.
      </p>
    </div>
  );
}
