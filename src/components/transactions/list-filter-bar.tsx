"use client";

import { useMemo } from "react";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";

/**
 * Client-side filter bar for list pages with date-range filtering.
 *
 * Emits `from` / `to` ISO date strings (yyyy-mm-dd) via the `onChange`
 * callback. The parent owns the state so SWR keys stay in sync. A
 * "custom" period reveals two DateInputs + an Apply button to keep the
 * URL params from updating on every keystroke.
 *
 * Designed to be drop-in next to the existing transaction-type chips —
 * see `/transactions` for the canonical usage.
 */

export type PeriodValue =
  | { kind: "all" }
  | { kind: "month"; year: number; month: number } // month is 0-indexed
  | { kind: "custom"; from: string; to: string };

export function periodToRange(p: PeriodValue): { from?: string; to?: string } {
  if (p.kind === "all") return {};
  if (p.kind === "custom") return { from: p.from, to: p.to };
  // Month: full month from day 1 to last day.
  const start = new Date(Date.UTC(p.year, p.month, 1));
  const end = new Date(Date.UTC(p.year, p.month + 1, 0));
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
  };
}

export function periodToId(p: PeriodValue): string {
  if (p.kind === "all") return "all";
  if (p.kind === "custom") return `custom:${p.from}:${p.to}`;
  return `${p.year}-${String(p.month + 1).padStart(2, "0")}`;
}

export function idToPeriod(id: string): PeriodValue {
  if (id === "all") return { kind: "all" };
  if (id.startsWith("custom:")) {
    const [, from = "", to = ""] = id.split(":");
    return { kind: "custom", from, to };
  }
  const [y, m] = id.split("-");
  const year = Number(y);
  const month = Number(m) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(month)) return { kind: "all" };
  return { kind: "month", year, month };
}

export function ListFilterBar({
  value,
  onChange,
  monthsBack = 24,
}: {
  value: PeriodValue;
  onChange: (next: PeriodValue) => void;
  /** How many recent months to surface in the dropdown. */
  monthsBack?: number;
}) {
  const monthOptions = useMemo(() => {
    const now = new Date();
    const out: { value: string; label: string }[] = [];
    for (let i = 0; i < monthsBack; i++) {
      const d = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1),
      );
      const id = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      const label = d.toLocaleDateString("en-IN", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      });
      out.push({ value: id, label });
    }
    return out;
  }, [monthsBack]);

  const selectedId = periodToId(value);
  const isCustom = value.kind === "custom";

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <div className="w-full sm:w-56">
        <NativeSelect
          value={selectedId}
          onChange={(next) => {
            if (next === "all") return onChange({ kind: "all" });
            if (next === "custom") {
              // Default to last 30 days when entering custom mode.
              const today = new Date();
              const past = new Date(today);
              past.setUTCDate(past.getUTCDate() - 30);
              return onChange({
                kind: "custom",
                from: past.toISOString().slice(0, 10),
                to: today.toISOString().slice(0, 10),
              });
            }
            onChange(idToPeriod(next));
          }}
          options={[
            { value: "all", label: "All time" },
            ...monthOptions,
            { value: "custom", label: "Custom range…" },
          ]}
        />
      </div>

      {isCustom && (
        <CustomRange value={value} onChange={onChange} />
      )}
    </div>
  );
}

function CustomRange({
  value,
  onChange,
}: {
  value: Extract<PeriodValue, { kind: "custom" }>;
  onChange: (next: PeriodValue) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <DateInput
        value={value.from}
        onChange={(e) => onChange({ ...value, from: e.target.value })}
      />
      <span className="text-xs text-muted-foreground">to</span>
      <DateInput
        value={value.to}
        onChange={(e) => onChange({ ...value, to: e.target.value })}
      />
      {value.from && value.to && new Date(value.to) < new Date(value.from) && (
        <span className="text-xs text-destructive">End is before start</span>
      )}
    </div>
  );
}

/**
 * Compact pagination footer — drop in below a list. Shows
 * "Showing X-Y of Z" + Prev / Next buttons. Hides itself when the
 * full list fits on one page.
 */
export function PaginationFooter({
  total,
  offset,
  limit,
  onChange,
}: {
  total: number;
  offset: number;
  limit: number;
  onChange: (nextOffset: number) => void;
}) {
  if (total <= limit) return null;
  const start = total === 0 ? 0 : offset + 1;
  const end = Math.min(total, offset + limit);
  const isFirst = offset === 0;
  const isLast = end >= total;
  return (
    <div className="flex items-center justify-between gap-3 px-1 py-2 text-xs text-muted-foreground">
      <span className="tabular-nums">
        Showing {start.toLocaleString()}–{end.toLocaleString()} of{" "}
        {total.toLocaleString()}
      </span>
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant="outline"
          disabled={isFirst}
          onClick={() => onChange(Math.max(0, offset - limit))}
        >
          ← Prev
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={isLast}
          onClick={() => onChange(offset + limit)}
        >
          Next →
        </Button>
      </div>
    </div>
  );
}
