"use client";

import { useEffect, useMemo } from "react";
import { Calendar } from "lucide-react";
import { DateInput } from "@/components/ui/date-input";
import { cn } from "@/lib/utils";

export type DateRange = {
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
};

export type DatePreset =
  | "this-month"
  | "last-month"
  | "this-quarter"
  | "this-year"
  | "last-12m"
  | "fy-current"
  | "fy-previous"
  | "custom";

const PRESET_LABELS: Record<DatePreset, string> = {
  "this-month": "This month",
  "last-month": "Last month",
  "this-quarter": "This quarter",
  "this-year": "This year",
  "last-12m": "Last 12 months",
  "fy-current": "FY (current)",
  "fy-previous": "FY (previous)",
  custom: "Custom",
};

/** Compute a concrete date range for a preset, anchored at `today`. */
export function presetRange(p: DatePreset, today = new Date()): DateRange {
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  const d = today.getUTCDate();
  const utc = (yy: number, mm: number, dd: number) =>
    new Date(Date.UTC(yy, mm, dd)).toISOString().slice(0, 10);
  switch (p) {
    case "this-month":
      return { start: utc(y, m, 1), end: utc(y, m + 1, 0) };
    case "last-month":
      return { start: utc(y, m - 1, 1), end: utc(y, m, 0) };
    case "this-quarter": {
      const qStart = Math.floor(m / 3) * 3;
      return { start: utc(y, qStart, 1), end: utc(y, qStart + 3, 0) };
    }
    case "this-year":
      return { start: utc(y, 0, 1), end: utc(y, 11, 31) };
    case "last-12m":
      return { start: utc(y, m - 11, 1), end: utc(y, m + 1, 0) };
    case "fy-current": {
      // Indian financial year: April 1 → March 31.
      const fyStart = m >= 3 ? y : y - 1;
      return { start: utc(fyStart, 3, 1), end: utc(fyStart + 1, 2, 31) };
    }
    case "fy-previous": {
      const fyStart = (m >= 3 ? y : y - 1) - 1;
      return { start: utc(fyStart, 3, 1), end: utc(fyStart + 1, 2, 31) };
    }
    case "custom":
      return { start: utc(y, m, d), end: utc(y, m, d) };
  }
}

export function ReportFilters({
  preset,
  onPresetChange,
  range,
  onRangeChange,
  presets = [
    "this-month",
    "last-month",
    "this-quarter",
    "this-year",
    "last-12m",
    "fy-current",
    "custom",
  ],
  extra,
}: {
  preset: DatePreset;
  onPresetChange: (p: DatePreset) => void;
  range: DateRange;
  onRangeChange: (r: DateRange) => void;
  presets?: DatePreset[];
  extra?: React.ReactNode;
}) {
  // Keep range in sync when a preset is picked.
  useEffect(() => {
    if (preset === "custom") return;
     
    onRangeChange(presetRange(preset));
     
  }, [preset, onRangeChange]);

  const showCustom = preset === "custom";

  return (
    <div className="rounded-xl border bg-card px-3 py-3 sm:px-4">
      <div className="flex flex-wrap items-center gap-2">
        <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
        <div className="flex flex-wrap gap-1">
          {presets.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onPresetChange(p)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                preset === p
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {PRESET_LABELS[p]}
            </button>
          ))}
        </div>
        {showCustom && (
          <div className="flex flex-wrap items-center gap-2 ml-1">
            <DateInput
              value={range.start}
              onChange={(e) =>
                onRangeChange({ ...range, start: e.target.value })
              }
              className="h-8 w-36"
              aria-label="Range start"
            />
            <span className="text-xs text-muted-foreground">→</span>
            <DateInput
              value={range.end}
              onChange={(e) =>
                onRangeChange({ ...range, end: e.target.value })
              }
              className="h-8 w-36"
              aria-label="Range end"
            />
          </div>
        )}
        {extra && <div className="ml-auto flex items-center gap-2">{extra}</div>}
      </div>
      {!showCustom && (
        <RangeLabel range={range} />
      )}
    </div>
  );
}

function RangeLabel({ range }: { range: DateRange }) {
  const fmt = useMemo(() => {
    try {
      const s = new Date(range.start);
      const e = new Date(range.end);
      const opts: Intl.DateTimeFormatOptions = {
        day: "numeric",
        month: "short",
        year: "numeric",
      };
      return `${s.toLocaleDateString(undefined, opts)} → ${e.toLocaleDateString(undefined, opts)}`;
    } catch {
      return "";
    }
  }, [range]);
  if (!fmt) return null;
  return (
    <div className="mt-1.5 text-[11px] text-muted-foreground">
      {fmt}
    </div>
  );
}
