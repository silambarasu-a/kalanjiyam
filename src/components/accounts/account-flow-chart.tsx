"use client";

import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatINR } from "@/lib/utils";

export type AccountFlowBucket = {
  id: string;
  label: string;
  rangeLabel: string;
  income: number;
  expense: number;
};

export function AccountFlowChart({ data }: { data: AccountFlowBucket[] }) {
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
    <div className="h-52 w-full min-w-0">
      {mounted && (
      <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={150}>
        <BarChart data={data} margin={{ top: 12, right: 8, left: 8, bottom: 4 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--color-border)"
            vertical={false}
          />
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
              const d = payload[0].payload as AccountFlowBucket;
              const net = d.income - d.expense;
              return (
                <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow space-y-0.5">
                  <div className="font-medium">{d.rangeLabel}</div>
                  <div className="tabular-nums text-emerald-700 dark:text-emerald-400">
                    In {formatINR(d.income)}
                  </div>
                  <div className="tabular-nums text-destructive">
                    Out {formatINR(d.expense)}
                  </div>
                  <div
                    className={`tabular-nums font-medium ${
                      net >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"
                    }`}
                  >
                    Net {net >= 0 ? "+" : "−"}
                    {formatINR(Math.abs(net))}
                  </div>
                </div>
              );
            }}
          />
          <Legend
            verticalAlign="top"
            height={20}
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 11, color: "var(--color-muted-foreground)" }}
          />
          <Bar dataKey="income" name="Income" fill="#16a34a" radius={[4, 4, 0, 0]} />
          <Bar dataKey="expense" name="Expense" fill="#ef4444" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
      )}
    </div>
  );
}
