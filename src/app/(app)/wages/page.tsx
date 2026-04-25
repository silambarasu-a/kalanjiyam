"use client";

import Link from "next/link";
import useSWR, { mutate as globalMutate } from "swr";
import { toast } from "sonner";
import { CalendarClock, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { mutateBalances } from "@/lib/mutate-balances";
import { formatINR, formatDate } from "@/lib/utils";

type Worker = {
  id: string;
  name: string;
  dailyRate: number | null;
  settlementCadence: string;
  balance: number;
  daysWorked: number;
};
type Settlement = {
  id: string;
  worker: { id: string; name: string };
  periodStart: string;
  periodEnd: string;
  cadence: string;
  amountDue: number;
  status: "PENDING" | "SETTLED" | "CANCELLED";
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function WagesPage() {
  const { data: workersData } = useSWR<{ workers: Worker[] }>("/api/workers", fetcher);
  const { data: pendingData } = useSWR<{ settlements: Settlement[] }>(
    "/api/wage-settlements?status=PENDING",
    fetcher
  );

  const workers = workersData?.workers ?? [];
  const pending = pendingData?.settlements ?? [];
  const totalOwed = workers.reduce((s, w) => s + Math.max(0, w.balance), 0);

  async function generatePending() {
    const res = await fetch("/api/wage-settlements", { method: "POST" });
    const body = await res.json();
    if (res.ok) {
      toast.success(
        body.created === 0
          ? "No new settlements due"
          : `Generated ${body.created} pending settlement${body.created === 1 ? "" : "s"}`
      );
      globalMutate("/api/wage-settlements?status=PENDING");
      globalMutate("/api/workers");
      await mutateBalances();
    } else {
      toast.error(body.error ?? "Failed");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Wages & attendance</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Running balances across your workers and any settlement windows that just closed.
          </p>
        </div>
        <Button onClick={generatePending} className="gap-2" variant="outline">
          <RefreshCw className="h-4 w-4" /> Generate pending
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Workers" value={String(workers.length)} />
        <Stat label="Total owed" value={formatINR(totalOwed)} tone="primary" />
        <Stat label="Pending settlements" value={String(pending.length)} />
      </div>

      <section>
        <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
          <CalendarClock className="h-4 w-4" /> Pending settlements
        </h2>
        <div className="rounded-xl border bg-card divide-y">
          {pending.map((s) => (
            <div key={s.id} className="flex items-center gap-3 px-5 py-3">
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{s.worker.name}</div>
                <div className="text-xs text-muted-foreground">
                  {formatDate(s.periodStart)} → {formatDate(s.periodEnd)} · {s.cadence}
                </div>
              </div>
              <div className="text-right">
                <div
                  className={`font-semibold ${s.amountDue > 0 ? "text-primary" : "text-muted-foreground"}`}
                >
                  {formatINR(s.amountDue)}
                </div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  PENDING
                </div>
              </div>
              <Link
                href={`/workers/${s.worker.id}`}
                className="rounded-md border border-input px-3 py-1 text-xs hover:bg-accent"
              >
                Open worker
              </Link>
            </div>
          ))}
          {pending.length === 0 && (
            <div className="px-5 py-6 text-sm text-muted-foreground text-center">
              No pending settlements. Tap <em>Generate pending</em> after a cadence period closes.
            </div>
          )}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold mb-2">Worker balances</h2>
        <div className="rounded-xl border bg-card divide-y">
          {workers.map((w) => (
            <Link
              key={w.id}
              href={`/workers/${w.id}`}
              className="flex items-center gap-3 px-5 py-3 hover:bg-accent transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{w.name}</div>
                <div className="text-xs text-muted-foreground">
                  {w.daysWorked} day{w.daysWorked === 1 ? "" : "s"} · {w.settlementCadence}
                </div>
              </div>
              <div className="text-right">
                <div
                  className={`font-semibold ${
                    w.balance > 0
                      ? "text-primary"
                      : w.balance < 0
                        ? "text-destructive"
                        : "text-muted-foreground"
                  }`}
                >
                  {w.balance > 0 ? "+" : w.balance < 0 ? "−" : ""}
                  {formatINR(Math.abs(w.balance))}
                </div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  {w.balance > 0 ? "OWED" : w.balance < 0 ? "ADVANCE" : "SETTLED"}
                </div>
              </div>
            </Link>
          ))}
          {workers.length === 0 && (
            <div className="px-5 py-6 text-sm text-muted-foreground text-center">
              No workers yet. Add them from the Workers page.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "primary";
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={`mt-1 text-2xl font-semibold ${tone === "primary" ? "text-primary" : "text-foreground"}`}
      >
        {value}
      </div>
    </div>
  );
}
