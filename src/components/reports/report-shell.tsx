"use client";

import Link from "next/link";
import { ChevronLeft, Download, FileSpreadsheet, Printer } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { downloadCSV, downloadExcel, printReport } from "@/lib/report-export";
import type { ExportPayload } from "@/lib/report-export";

/**
 * Shell for an individual report page. Provides:
 *
 *   - Back link to /reports catalog
 *   - Title + description
 *   - Slot for filters
 *   - Slot for KPI cards
 *   - Slot for chart
 *   - Slot for the main table
 *   - Standard export menu (CSV / Excel / Print → PDF)
 *
 * The page hands the shell an `exportPayload` builder that runs at the
 * moment the user clicks Export, so we don't pay the cost on every render.
 */
export function ReportShell<T extends Record<string, unknown>>({
  title,
  description,
  filters,
  kpis,
  chart,
  children,
  exportPayload,
}: {
  title: string;
  description?: string;
  filters?: React.ReactNode;
  kpis?: React.ReactNode;
  chart?: React.ReactNode;
  children: React.ReactNode;
  exportPayload?: () => ExportPayload<T>;
}) {
  return (
    <div className="space-y-6 print-container">
      <div className="no-print">
        <Link href="/reports" className="text-xs text-muted-foreground inline-flex items-center gap-1">
          <ChevronLeft className="h-3 w-3" /> Reports
        </Link>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description && (
            <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
              {description}
            </p>
          )}
        </div>
        {exportPayload && (
          <div className="no-print flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors">
                <Download className="h-3.5 w-3.5" /> Export
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem
                  onClick={() => downloadCSV(exportPayload())}
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" /> CSV
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={async () => {
                    await downloadExcel(exportPayload());
                  }}
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" /> Excel (.xlsx)
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    // Defer so the dropdown's portal content unmounts before
                    // window.print snapshots the page — otherwise the open
                    // menu shows up in the print preview.
                    setTimeout(printReport, 80);
                  }}
                >
                  <Printer className="h-3.5 w-3.5" /> Print / PDF
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
      {filters && <div className="no-print">{filters}</div>}
      {kpis && <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{kpis}</div>}
      {chart && <div className="rounded-xl border bg-card p-4 sm:p-5">{chart}</div>}
      {children}
    </div>
  );
}

export function ReportKpi({
  label,
  value,
  hint,
  tone = "default",
  highlight,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "primary" | "destructive" | "muted";
  highlight?: boolean;
}) {
  const valueColor =
    tone === "primary"
      ? "text-primary"
      : tone === "destructive"
        ? "text-destructive"
        : tone === "muted"
          ? "text-muted-foreground"
          : "text-foreground";
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={`mt-1 ${highlight ? "text-2xl" : "text-lg"} font-semibold ${valueColor}`}
      >
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
