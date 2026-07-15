"use client";

import { useEffect, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatINR } from "@/lib/utils";

export type FlowBucket = {
  key: string;
  label: string;
  inflow: number;
  outflow: number;
  net: number;
  cumulativeNet: number;
};

const compact = (v: number) =>
  Math.abs(v) >= 100000
    ? `${v < 0 ? "−" : ""}${(Math.abs(v) / 100000).toFixed(1)}L`
    : Math.abs(v) >= 1000
      ? `${v < 0 ? "−" : ""}${(Math.abs(v) / 1000).toFixed(0)}k`
      : `${v}`;

/**
 * Monthly cash exchanged with a contact: grouped bars for money received
 * (in) vs paid / sent (out), overlaid with a running net-position line
 * (cumulative in − out, seeded by the balance before the window).
 */
export function ContactFlowChart({ data }: { data: FlowBucket[] }) {
  const [mounted, setMounted] = useState(false);
  /* eslint-disable react-hooks/set-state-in-effect -- one-shot mount flag */
  useEffect(() => setMounted(true), []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const hasFlow = data.some((d) => d.inflow > 0 || d.outflow > 0);
  if (!hasFlow) {
    return (
      <div className="flex h-64 items-center justify-center text-xs text-muted-foreground">
        No money moved to or from this contact in this period.
      </div>
    );
  }

  return (
    <div className="h-64 w-full min-w-0">
      {mounted && (
        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={200}>
          <ComposedChart data={data} margin={{ top: 12, right: 8, left: 8, bottom: 4 }}>
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
              minTickGap={16}
            />
            <YAxis
              yAxisId="cash"
              tickLine={false}
              axisLine={false}
              width={48}
              tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
              tickFormatter={compact}
            />
            <Tooltip
              cursor={{ fill: "var(--color-muted)", opacity: 0.4 }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload as FlowBucket;
                return (
                  <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow space-y-0.5">
                    <div className="font-medium">{d.label}</div>
                    <div className="tabular-nums text-emerald-700 dark:text-emerald-400">
                      In {formatINR(d.inflow)}
                    </div>
                    <div className="tabular-nums text-destructive">
                      Out {formatINR(d.outflow)}
                    </div>
                    <div
                      className={`tabular-nums font-medium ${
                        d.net >= 0
                          ? "text-emerald-700 dark:text-emerald-400"
                          : "text-destructive"
                      }`}
                    >
                      Net {d.net >= 0 ? "+" : "−"}
                      {formatINR(Math.abs(d.net))}
                    </div>
                    <div className="tabular-nums text-muted-foreground border-t mt-1 pt-1">
                      Running {formatINR(d.cumulativeNet)}
                    </div>
                  </div>
                );
              }}
            />
            <Legend
              verticalAlign="top"
              height={22}
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: 11, color: "var(--color-muted-foreground)" }}
            />
            <Bar
              yAxisId="cash"
              dataKey="inflow"
              name="Received"
              fill="#16a34a"
              radius={[3, 3, 0, 0]}
              maxBarSize={28}
            />
            <Bar
              yAxisId="cash"
              dataKey="outflow"
              name="Paid / sent"
              fill="#ef4444"
              radius={[3, 3, 0, 0]}
              maxBarSize={28}
            />
            <Line
              yAxisId="cash"
              type="monotone"
              dataKey="cumulativeNet"
              name="Running net"
              stroke="var(--color-primary)"
              strokeWidth={2}
              dot={{ r: 2 }}
              activeDot={{ r: 4 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
