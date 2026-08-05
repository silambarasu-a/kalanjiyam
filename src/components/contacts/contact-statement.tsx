"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { ArrowDownLeft, ArrowUpRight, Download, FileSpreadsheet, Printer } from "lucide-react";
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
import { CategoryBreakdown } from "@/components/cards/category-breakdown";
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
  hint: string | null;
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
  /** Hand-loan principal each way, plus interest actually settled. Reported
   *  alongside the charge-based position, never merged into it. */
  loanPositions?: {
    theyOweYouPrincipal: number;
    youOweThemPrincipal: number;
    interestReceived: number;
    interestPaid: number;
  };
  monthly: FlowBucket[];
  /** Optional so a stale SWR cache entry from before this field existed
   *  can't crash the tab. */
  spendByCategory?: { name: string; amount: number }[];
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

function badgeClass(e: StatementEvent): string {
  // Colour by cash direction first so the badge always agrees with the
  // Money in / Money out column; obligation & informational rows fall back
  // to their group colour.
  if (e.direction === "IN")
    return "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400";
  if (e.direction === "OUT")
    return "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400";
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
  const lp = data?.loanPositions;
  const events = data?.events ?? [];
  const monthly = data?.monthly ?? [];
  const spendByCategory = data?.spendByCategory ?? [];

  const theyOweYou = s?.theyOweYou ?? 0;
  const youOweThem = s?.youOweThem ?? 0;
  const net = theyOweYou - youOweThem;

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

  // One plain-language line that nets the two directions.
  const netSentence = (() => {
    if (theyOweYou === 0 && youOweThem === 0)
      return `All settled up — nothing outstanding either way with ${contactName}.`;
    if (theyOweYou > 0 && youOweThem === 0)
      return `${contactName} owes you ${formatINR(theyOweYou)}.`;
    if (youOweThem > 0 && theyOweYou === 0)
      return `You owe ${contactName} ${formatINR(youOweThem)}.`;
    // Both directions have a balance.
    if (net > 0)
      return `Both directions have balances — netted, ${contactName} still owes you ${formatINR(net)}.`;
    if (net < 0)
      return `Both directions have balances — netted, you still owe ${contactName} ${formatINR(-net)}.`;
    return `Both directions balance out exactly — you're even.`;
  })();

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
    // Export chronologically (oldest first) — natural reading order for a
    // statement with a running balance.
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
      subtitle: `${rangeLabel} · They owe you ${formatINR(theyOweYou)} · You owe them ${formatINR(youOweThem)}`,
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
    <div className="space-y-6 print-container">
      {/* ── Standing balance — the headline: who owes whom, right now. ── */}
      <section className="space-y-2.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h3 className="text-sm font-semibold">Balance right now</h3>
          <span className="text-[11px] text-muted-foreground">
            as of today · not affected by the period filter below
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <BalanceCard
            label="They owe you"
            hint={`money ${contactName} still owes you`}
            value={theyOweYou}
            tone="in"
          />
          <BalanceCard
            label="You owe them"
            hint={`money you still owe ${contactName}`}
            value={youOweThem}
            tone="out"
          />
        </div>
        <p
          className={`text-sm font-medium ${
            net > 0
              ? "text-emerald-700 dark:text-emerald-400"
              : net < 0
                ? "text-destructive"
                : "text-muted-foreground"
          }`}
        >
          {netSentence}
        </p>
        {/* Hand loans are reported as their own labelled pair. Deliberately
            not folded into the two cards above (which are charge-based) and
            never netted against each other. */}
        {lp && (lp.theyOweYouPrincipal > 0 || lp.youOweThemPrincipal > 0) && (
          <div className="rounded-lg border bg-muted/30 p-3 text-xs">
            <div className="font-medium">Hand loans</div>
            <div className="mt-1.5 grid grid-cols-1 gap-1 sm:grid-cols-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-muted-foreground">
                  They owe you · principal
                </span>
                <span className="tabular-nums">
                  {formatINR(lp.theyOweYouPrincipal)}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-muted-foreground">
                  You owe them · principal
                </span>
                <span className="tabular-nums">
                  {formatINR(lp.youOweThemPrincipal)}
                </span>
              </div>
              {lp.interestReceived > 0 && (
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-muted-foreground">Interest received</span>
                  <span className="tabular-nums">
                    {formatINR(lp.interestReceived)}
                  </span>
                </div>
              )}
              {lp.interestPaid > 0 && (
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-muted-foreground">Interest paid</span>
                  <span className="tabular-nums">
                    {formatINR(lp.interestPaid)}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {/* ── Period filter — its own labelled, full-width row. ── */}
      <section className="no-print space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Filter activity by period
          </span>
        </div>
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
      </section>

      {/* Print-only header. */}
      <div className="hidden print:block">
        <h2 className="text-lg font-semibold">Statement — {contactName}</h2>
        <p className="text-xs text-muted-foreground">
          {rangeLabel} · They owe you {formatINR(theyOweYou)} · You owe them{" "}
          {formatINR(youOweThem)}
        </p>
      </div>

      {/* ── Activity in the selected period. ── */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">
            Activity{" "}
            <span className="font-normal text-muted-foreground">· {rangeLabel}</span>
          </h3>
          <DropdownMenu>
            <DropdownMenuTrigger className="no-print inline-flex shrink-0 items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors">
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

        {/* Period money summary. */}
        <div className="grid grid-cols-3 gap-3">
          <MiniStat
            label="Received"
            value={formatINR(s?.received ?? 0)}
            tone="in"
            icon={<ArrowDownLeft className="h-3.5 w-3.5" />}
          />
          <MiniStat
            label="Paid / sent"
            value={formatINR(s?.paid ?? 0)}
            tone="out"
            icon={<ArrowUpRight className="h-3.5 w-3.5" />}
          />
          <MiniStat
            label="Net"
            value={`${(s?.netCash ?? 0) >= 0 ? "+" : "−"}${formatINR(Math.abs(s?.netCash ?? 0))}`}
            tone={(s?.netCash ?? 0) >= 0 ? "in" : "out"}
          />
        </div>

        {/* Charts. */}
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border bg-card p-4 sm:p-5 min-w-0">
            <h4 className="mb-2 text-sm font-semibold">
              Money in &amp; out with {contactName}, by month
            </h4>
            <ContactFlowChart data={monthly} />
          </div>
          <div className="rounded-xl border bg-card p-4 sm:p-5 min-w-0">
            {/* Deliberately NOT titled "Spent on them" — on this page that
                phrase means strictly non-recoverable spend (header stat +
                tab). This pie is broader: it also counts recoverable
                expenses you laid out ("Paid for them" rows). */}
            <h4 className="text-sm font-semibold">Spend by category</h4>
            <p className="text-xs text-muted-foreground">
              Everything you paid for or spent on {contactName} in this period ·{" "}
              {formatINR(spendByCategory.reduce((s, d) => s + d.amount, 0))}
            </p>
            <div className="mt-3 min-w-0">
              <CategoryBreakdown data={spendByCategory} />
            </div>
          </div>
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
                      {(e.account || e.direction === "NEUTRAL") && (
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {e.account ? <span>{e.account}</span> : null}
                          {e.direction === "NEUTRAL" && (
                            <span>
                              {e.account ? " · " : ""}
                              {formatINR(e.amount)}
                              {e.hint ? ` · ${e.hint}` : ""}
                            </span>
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right align-top tabular-nums text-sm text-emerald-700 dark:text-emerald-400">
                      {e.direction === "IN" ? formatINR(e.amount) : ""}
                    </TableCell>
                    <TableCell className="text-right align-top tabular-nums text-sm text-destructive">
                      {e.direction === "OUT" ? formatINR(e.amount) : ""}
                    </TableCell>
                  </TableRow>
                );
              })}
              {events.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
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
                    {(s?.eventCount ?? events.length) === 1 ? "" : "s"} in this period
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-semibold text-emerald-700 dark:text-emerald-400">
                    {formatINR(s?.received ?? 0)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-semibold text-destructive">
                    {formatINR(s?.paid ?? 0)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </div>

        <p className="text-[11px] leading-relaxed text-muted-foreground no-print">
          <span className="font-medium">Money in</span> = cash you received from{" "}
          {contactName} (transfers received &amp; repayments).{" "}
          <span className="font-medium">Money out</span> = cash that left your accounts
          for them (transfers sent, payments, and expenses you paid — even if recoverable).
          Amber rows are obligations booked without your cash moving (a transfer already
          counted, or something they paid for you); these show the amount inline and
          don&apos;t affect the in/out totals. Whether they still owe you is shown up top in{" "}
          <span className="font-medium">Balance right now</span>.
        </p>
      </section>
    </div>
  );
}

/** Big, colour-coded owe/owed card. Muted when the balance is zero. */
function BalanceCard({
  label,
  hint,
  value,
  tone,
}: {
  label: string;
  hint: string;
  value: number;
  tone: "in" | "out";
}) {
  const active = value > 0;
  const activeCls =
    tone === "in"
      ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/60 dark:bg-emerald-950/30"
      : "border-red-200 bg-red-50/60 dark:border-red-900/60 dark:bg-red-950/30";
  const valueCls = !active
    ? "text-muted-foreground"
    : tone === "in"
      ? "text-emerald-700 dark:text-emerald-400"
      : "text-destructive";
  return (
    <div className={`rounded-xl border p-4 ${active ? activeCls : "bg-card"}`}>
      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${valueCls}`}>
        {formatINR(value)}
      </div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">
        {active ? hint : "nothing outstanding"}
      </div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: string;
  tone: "in" | "out";
  icon?: React.ReactNode;
}) {
  const valueCls =
    tone === "in"
      ? "text-emerald-700 dark:text-emerald-400"
      : "text-destructive";
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className={`mt-1 text-base font-semibold tabular-nums ${valueCls}`}>
        {value}
      </div>
    </div>
  );
}
