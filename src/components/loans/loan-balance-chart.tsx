"use client";

import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatINR } from "@/lib/utils";

export type BalancePoint = {
  date: string;
  label: string;
  balance: number;
  payment?: number;
};

export function LoanBalanceChart({ data }: { data: BalancePoint[] }) {
  const [mounted, setMounted] = useState(false);
  /* eslint-disable react-hooks/set-state-in-effect -- one-shot mount flag */
  useEffect(() => setMounted(true), []);
  /* eslint-enable react-hooks/set-state-in-effect */
  if (data.length < 2) {
    return (
      <div className="flex h-44 items-center justify-center text-xs text-muted-foreground">
        Not enough payments yet to plot a trend.
      </div>
    );
  }
  return (
    <div className="w-full min-w-0">
      {mounted && (
        // Aspect ratio (rather than percentage height) lets recharts
        // size the chart deterministically from the measured width on
        // the very first paint — avoids the noisy "width(-1)/height(-1)"
        // warning the percentage path emits before its first ResizeObserver
        // tick.
        <ResponsiveContainer width="100%" aspect={3} minWidth={0}>
          <AreaChart data={data} margin={{ top: 12, right: 8, left: 8, bottom: 4 }}>
            <defs>
              <linearGradient id="loanBalanceFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-primary)" stopOpacity={0.4} />
                <stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0} />
              </linearGradient>
            </defs>
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
              minTickGap={24}
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
              cursor={{ stroke: "var(--color-muted-foreground)", strokeDasharray: "3 3" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload as BalancePoint;
                return (
                  <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow space-y-0.5">
                    <div className="font-medium">{d.label}</div>
                    <div className="tabular-nums">
                      Outstanding {formatINR(d.balance)}
                    </div>
                    {d.payment != null && (
                      <div className="tabular-nums text-destructive">
                        Paid {formatINR(d.payment)}
                      </div>
                    )}
                  </div>
                );
              }}
            />
            <Area
              type="monotone"
              dataKey="balance"
              stroke="var(--color-primary)"
              strokeWidth={2}
              fill="url(#loanBalanceFill)"
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
