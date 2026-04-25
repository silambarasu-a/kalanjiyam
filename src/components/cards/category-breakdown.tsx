"use client";

import { useEffect, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { formatINR } from "@/lib/utils";

export type CategorySlice = {
  name: string;
  amount: number;
};

// Distinct, accessible-ish palette tuned for the project's brand greens + warm
// accents. Cycles if there are more slices than colors.
const PALETTE = [
  "#16a34a", // emerald-600 (primary-ish)
  "#0ea5e9", // sky-500
  "#f59e0b", // amber-500
  "#ef4444", // red-500
  "#8b5cf6", // violet-500
  "#14b8a6", // teal-500
  "#f97316", // orange-500
  "#64748b", // slate-500
];

export function CategoryBreakdown({ data }: { data: CategorySlice[] }) {
  const [mounted, setMounted] = useState(false);
  /* eslint-disable react-hooks/set-state-in-effect -- one-shot mount flag */
  useEffect(() => setMounted(true), []);
  /* eslint-enable react-hooks/set-state-in-effect */
  const total = data.reduce((s, d) => s + d.amount, 0);
  if (total === 0) {
    return (
      <div className="flex h-44 items-center justify-center text-xs text-muted-foreground">
        No spend in this period.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-[8rem_1fr] items-center gap-3 h-44 w-full min-w-0">
      <div className="h-full w-full min-w-0">
        {mounted && (
        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={120}>
          <PieChart>
          <Pie
            data={data}
            dataKey="amount"
            nameKey="name"
            innerRadius="55%"
            outerRadius="85%"
            paddingAngle={2}
            stroke="var(--color-card)"
            strokeWidth={2}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
            ))}
          </Pie>
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as CategorySlice;
              const pct = total > 0 ? (d.amount / total) * 100 : 0;
              return (
                <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow">
                  <div className="font-medium">{d.name}</div>
                  <div className="text-muted-foreground tabular-nums">
                    {formatINR(d.amount)} · {pct.toFixed(0)}%
                  </div>
                </div>
              );
            }}
          />
        </PieChart>
        </ResponsiveContainer>
        )}
      </div>
      <ul className="space-y-1.5 text-xs overflow-y-auto max-h-44 pr-1">
        {data.map((d, i) => {
          const pct = total > 0 ? (d.amount / total) * 100 : 0;
          return (
            <li key={d.name} className="flex items-center gap-2">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm shrink-0"
                style={{ background: PALETTE[i % PALETTE.length] }}
              />
              <span className="flex-1 truncate">{d.name}</span>
              <span className="tabular-nums text-muted-foreground">
                {pct.toFixed(0)}%
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
