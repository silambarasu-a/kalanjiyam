"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type Column<T> = {
  key: keyof T & string;
  label: string;
  align?: "left" | "right" | "center";
  className?: string;
  thClassName?: string;
  /** Custom cell renderer. Defaults to String(value). */
  render?: (row: T) => React.ReactNode;
  /** Use a computed sort key (e.g. number behind a formatted string). */
  sortValue?: (row: T) => string | number | null;
  sortable?: boolean;
};

/**
 * Generic sortable table for report pages. Sorts client-side using either
 * the column's `sortValue` accessor or `row[key]` raw. Supports a totals
 * row (rendered in a styled `<tfoot>`) and a sticky header for long tables.
 *
 * Mobile rendering is left to the caller — for narrow viewports, render a
 * stacked card list above this table and hide the table with `hidden md:table`.
 */
export function SortableTable<T extends Record<string, unknown>>({
  columns,
  rows,
  totals,
  defaultSort,
  className,
  emptyLabel = "No data",
  rowKey,
}: {
  columns: Column<T>[];
  rows: T[];
  totals?: Partial<Record<keyof T & string, React.ReactNode>>;
  defaultSort?: { key: keyof T & string; dir: "asc" | "desc" };
  className?: string;
  emptyLabel?: string;
  rowKey: (row: T, i: number) => string;
}) {
  const [sortKey, setSortKey] = useState<(keyof T & string) | null>(
    defaultSort?.key ?? null,
  );
  const [sortDir, setSortDir] = useState<"asc" | "desc">(
    defaultSort?.dir ?? "desc",
  );

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    const col = columns.find((c) => c.key === sortKey);
    const accessor = col?.sortValue ?? ((r: T) => r[sortKey] as unknown);
    const arr = [...rows];
    arr.sort((a, b) => {
      const av = accessor(a);
      const bv = accessor(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      let cmp = 0;
      if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
      else cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [rows, columns, sortKey, sortDir]);

  function toggleSort(k: keyof T & string) {
    if (sortKey === k) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      setSortDir("desc");
    }
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border bg-card px-5 py-8 text-center text-sm text-muted-foreground">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className={cn("rounded-lg border bg-card overflow-x-auto", className)}>
      <table className="w-full text-sm">
        <thead className="bg-muted/30">
          <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b">
            {columns.map((c) => {
              const sortable = c.sortable !== false;
              const active = sortKey === c.key;
              return (
                <th
                  key={c.key}
                  className={cn(
                    "px-4 sm:px-5 py-2 whitespace-nowrap",
                    c.align === "right"
                      ? "text-right"
                      : c.align === "center"
                        ? "text-center"
                        : "text-left",
                    sortable && "cursor-pointer select-none hover:text-foreground",
                    c.thClassName,
                  )}
                  onClick={sortable ? () => toggleSort(c.key) : undefined}
                  aria-sort={
                    !active
                      ? "none"
                      : sortDir === "asc"
                        ? "ascending"
                        : "descending"
                  }
                >
                  <span className="inline-flex items-center gap-1">
                    {c.label}
                    {sortable && (
                      active ? (
                        sortDir === "asc" ? (
                          <ArrowUp className="h-3 w-3" />
                        ) : (
                          <ArrowDown className="h-3 w-3" />
                        )
                      ) : (
                        <ChevronsUpDown className="h-3 w-3 opacity-40" />
                      )
                    )}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr
              key={rowKey(row, i)}
              className="border-b last:border-0 hover:bg-muted/20"
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={cn(
                    "px-4 sm:px-5 py-2.5",
                    c.align === "right"
                      ? "text-right tabular-nums"
                      : c.align === "center"
                        ? "text-center"
                        : "",
                    c.className,
                  )}
                >
                  {c.render ? c.render(row) : ((row[c.key] ?? "—") as React.ReactNode)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {totals && (
          <tfoot>
            <tr className="border-t-2 bg-muted/40 font-semibold text-sm">
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={cn(
                    "px-4 sm:px-5 py-2.5",
                    c.align === "right"
                      ? "text-right tabular-nums"
                      : c.align === "center"
                        ? "text-center"
                        : "",
                  )}
                >
                  {totals?.[c.key] ?? ""}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
