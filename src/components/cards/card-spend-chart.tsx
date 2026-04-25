"use client";

import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatINR } from "@/lib/utils";

export type CardSpendBucket = {
  /** Period id (used as React key + tooltip subtitle). */
  id: string;
  /** Short display label, e.g. "Apr". */
  label: string;
  /** Long label for tooltip — e.g. "12 Apr — 11 May". */
  rangeLabel: string;
  spend: number;
  /** Highlight the currently selected period. */
  isActive?: boolean;
};

export function CardSpendChart({ data }: { data: CardSpendBucket[] }) {
  // Defer until after mount so ResponsiveContainer can measure the parent.
  const [mounted, setMounted] = useState(false);
  /* eslint-disable react-hooks/set-state-in-effect -- one-shot mount flag */
  useEffect(() => setMounted(true), []);
  /* eslint-enable react-hooks/set-state-in-effect */
  if (data.length === 0) {
    return (
      <div className="flex h-44 items-center justify-center text-xs text-muted-foreground">
        No data yet.
      </div>
    );
  }
  return (
    <div className="h-44 w-full min-w-0">
      {mounted && (
      <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={120}>
        <BarChart data={data} margin={{ top: 12, right: 8, left: 8, bottom: 4 }}>
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={48}
            tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
            tickFormatter={(v: number) =>
              v >= 100000
                ? `${(v / 100000).toFixed(1)}L`
                : v >= 1000
                  ? `${(v / 1000).toFixed(0)}k`
                  : `${v}`
            }
          />
          <Tooltip
            cursor={{ fill: "var(--color-muted)", opacity: 0.4 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as CardSpendBucket;
              return (
                <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow">
                  <div className="font-medium">{d.rangeLabel}</div>
                  <div className="text-muted-foreground tabular-nums">
                    {formatINR(d.spend)}
                  </div>
                </div>
              );
            }}
          />
          <Bar dataKey="spend" radius={[6, 6, 0, 0]}>
            {data.map((d) => (
              <Cell
                key={d.id}
                fill={d.isActive ? "var(--color-primary)" : "var(--color-muted-foreground)"}
                fillOpacity={d.isActive ? 1 : 0.35}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      )}
    </div>
  );
}
