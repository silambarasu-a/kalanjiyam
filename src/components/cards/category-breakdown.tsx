"use client";

import { useEffect, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { formatINR } from "@/lib/utils";

export type CategorySlice = {
  name: string;
  amount: number;
};

// Categorical palette lives in globals.css (--chart-1…7 with a .dark
// re-step) so both themes render validated colors. Slot count is fixed:
// slices past the 7th fold into a single neutral "Other" — hues are
// never cycled, and gray is reserved for the fold, not an identity.
const IDENTITY_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
  "var(--chart-7)",
];
const OTHER_COLOR = "var(--chart-other)";
const OTHER_NAME = "Other";

function foldSlices(data: CategorySlice[]): CategorySlice[] {
  if (data.length <= IDENTITY_COLORS.length + 1) return data;
  const kept = data.slice(0, IDENTITY_COLORS.length);
  const rest = data.slice(IDENTITY_COLORS.length);
  return [
    ...kept,
    { name: OTHER_NAME, amount: rest.reduce((s, d) => s + d.amount, 0) },
  ];
}

const sliceColor = (slice: CategorySlice, i: number) =>
  i >= IDENTITY_COLORS.length || slice.name === OTHER_NAME
    ? OTHER_COLOR
    : IDENTITY_COLORS[i];

export function CategoryBreakdown({ data }: { data: CategorySlice[] }) {
  const [mounted, setMounted] = useState(false);
  /* eslint-disable react-hooks/set-state-in-effect -- one-shot mount flag */
  useEffect(() => setMounted(true), []);
  /* eslint-enable react-hooks/set-state-in-effect */
  const slices = foldSlices(data);
  const total = slices.reduce((s, d) => s + d.amount, 0);
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
            data={slices}
            dataKey="amount"
            nameKey="name"
            innerRadius="55%"
            outerRadius="85%"
            paddingAngle={2}
            stroke="var(--color-card)"
            strokeWidth={2}
          >
            {slices.map((d, i) => (
              <Cell key={i} fill={sliceColor(d, i)} />
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
        {slices.map((d, i) => {
          const pct = total > 0 ? (d.amount / total) * 100 : 0;
          return (
            <li key={d.name} className="flex items-center gap-2">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm shrink-0"
                style={{ background: sliceColor(d, i) }}
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
