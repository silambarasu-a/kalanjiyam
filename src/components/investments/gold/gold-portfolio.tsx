"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Plus, Gem, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { fetcher } from "@/lib/swr-fetcher";
import { formatINR, formatDate, cn } from "@/lib/utils";
import { fineGrams } from "@/lib/gold";

export type GoldOrnamentRow = {
  id: string;
  name: string;
  itemType: string | null;
  purity: string | null;
  quantity: number;
  netWeightGrams: number;
  lineTotal: number;
  costBasis: number;
  declaredValue: number | null;
  status: "HELD" | "SOLD" | "GIFTED_OUT" | "EXCHANGED";
  disposalAmount: number | null;
  realisedGain: number | null;
  assignedContact: { id: string; name: string } | null;
  boughtForContact: { id: string; name: string } | null;
  disposalContact: { id: string; name: string } | null;
  memberCharge: {
    id: string;
    amount: number;
    settledAmount: number;
    status: string;
  } | null;
  acquisition: {
    id: string;
    kind: "PURCHASE" | "GIFT_RECEIVED" | "OPENING_STOCK";
    sellerName: string | null;
    billNumber: string | null;
    acquiredAt: string;
    investmentId: string | null;
    giftedByContact: { id: string; name: string } | null;
  };
};

const STATUS_OPTIONS = [
  { value: "HELD", label: "Held" },
  { value: "SOLD", label: "Sold" },
  { value: "GIFTED_OUT", label: "Gifted away" },
  { value: "EXCHANGED", label: "Exchanged" },
  { value: "ALL", label: "All" },
];

/**
 * The flat ornament list — one row per physical piece, whichever bill it
 * came in on. Pieces bought for a contact are shown but marked, and are
 * excluded from every holdings figure: they're that contact's asset, and
 * their money lives in the receivable, not here.
 */
export function GoldPortfolio() {
  const [status, setStatus] = useState("HELD");
  const [rate, setRate] = useState("");
  const [revaluing, setRevaluing] = useState(false);

  const { data, isLoading, mutate } = useSWR<{
    ornaments: GoldOrnamentRow[];
    unItemisedCount: number;
  }>(`/api/gold/ornaments?status=${status}`, fetcher);

  const ornaments = useMemo(() => data?.ornaments ?? [], [data]);

  const stats = useMemo(() => {
    let grams = 0;
    let fine = 0;
    let invested = 0;
    let realised = 0;
    let owedToYou = 0;
    for (const o of ornaments) {
      if (o.boughtForContact) {
        if (o.memberCharge && o.memberCharge.status !== "WRITTEN_OFF") {
          owedToYou += o.memberCharge.amount - o.memberCharge.settledAmount;
        }
        continue;
      }
      if (o.status === "HELD") {
        grams += o.netWeightGrams;
        fine += fineGrams(o.netWeightGrams, o.purity);
        invested += o.costBasis;
      }
      // A trade-in realises a gain just like a sale — the value left the
      // piece and went into a new bill instead of into an account.
      if (
        (o.status === "SOLD" || o.status === "EXCHANGED") &&
        o.realisedGain != null
      ) {
        realised += o.realisedGain;
      }
    }
    return { grams, fine, invested, realised, owedToYou };
  }, [ornaments]);

  async function revalue() {
    const r = Number(rate);
    if (!r || r <= 0) {
      toast.error("Enter today's 24K rate per gram");
      return;
    }
    setRevaluing(true);
    try {
      const res = await fetch("/api/gold/revalue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ratePerGram24K: r, includeStonesAtCost: true }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? "Couldn't revalue");
        return;
      }
      toast.success(`Revalued ${json.updated} holding(s)`);
      mutate();
    } finally {
      setRevaluing(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Gold &amp; jewellery
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every ornament individually, with the bill it came in on.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="flex gap-1">
            <Input
              type="number"
              step="0.01"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              placeholder="24K ₹/g"
              className="w-28"
            />
            <Button
              variant="outline"
              onClick={revalue}
              disabled={revaluing}
              className="gap-1"
            >
              {revaluing && <Loader2 className="h-4 w-4 animate-spin" />}
              Revalue
            </Button>
          </div>
          <Link
            href="/investments/gold/new"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-4 w-4" /> Add gold
          </Link>
        </div>
      </div>

      {(data?.unItemisedCount ?? 0) > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-400/60 bg-amber-50 p-3 text-sm dark:border-amber-500/40 dark:bg-amber-950/30">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-amber-900 dark:text-amber-200">
            {data?.unItemisedCount} older gold holding
            {data?.unItemisedCount === 1 ? " isn't" : "s aren't"} itemised into
            ornaments yet, so {data?.unItemisedCount === 1 ? "it doesn't" : "they don't"}{" "}
            appear below. They&apos;re still counted in Investments.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Grams held" value={`${stats.grams.toFixed(3)} g`} />
        <Stat label="Fine (24K eq.)" value={`${stats.fine.toFixed(3)} g`} />
        <Stat label="Invested" value={formatINR(stats.invested)} />
        <Stat
          label="Realised (all time)"
          value={`${stats.realised >= 0 ? "+" : "−"}${formatINR(Math.abs(stats.realised))}`}
          tone={stats.realised >= 0 ? "primary" : "destructive"}
        />
        <Stat
          label="Owed to you"
          value={formatINR(stats.owedToYou)}
          sub="bought for others"
        />
      </div>

      <div className="flex items-center gap-2">
        <NativeSelect
          value={status}
          onChange={setStatus}
          options={STATUS_OPTIONS}
          className="w-40"
        />
        <span className="text-sm text-muted-foreground">
          {ornaments.length} ornament{ornaments.length === 1 ? "" : "s"}
        </span>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {!isLoading && ornaments.length === 0 && (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <Gem className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-2 text-sm text-muted-foreground">
            No ornaments yet. Add a jeweller bill, a gift, or gold you already
            own.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {ornaments.map((o) => (
          <Link
            key={o.id}
            href={`/investments/gold/${o.id}`}
            className={cn(
              "rounded-xl border bg-card p-4 transition hover:bg-accent/40",
              o.boughtForContact &&
                "border-amber-400/60 dark:border-amber-500/40",
            )}
          >
            <div className="flex items-start gap-3">
              <Gem className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-semibold">{o.name}</span>
                  {o.purity && (
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold">
                      {o.purity}
                    </span>
                  )}
                  {o.boughtForContact && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                      {o.boughtForContact.name}&apos;s
                    </span>
                  )}
                  {o.acquisition.kind === "GIFT_RECEIVED" && (
                    <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-800 dark:bg-violet-900/40 dark:text-violet-300">
                      Gift
                    </span>
                  )}
                  {o.status !== "HELD" && (
                    <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                      {o.status === "SOLD"
                        ? "Sold"
                        : o.status === "EXCHANGED"
                          ? "Exchanged"
                          : "Gifted away"}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                  {o.netWeightGrams}g
                  {o.assignedContact ? ` · for ${o.assignedContact.name}` : ""}
                  {o.acquisition.sellerName
                    ? ` · ${o.acquisition.sellerName}`
                    : ""}
                  {o.acquisition.billNumber
                    ? ` · ${o.acquisition.billNumber}`
                    : ""}
                  {` · ${formatDate(o.acquisition.acquiredAt)}`}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="font-semibold tabular-nums">
                  {formatINR(o.lineTotal)}
                </div>
                {o.boughtForContact && o.memberCharge && (
                  <div className="text-[11px] text-amber-700 dark:text-amber-400">
                    {formatINR(
                      o.memberCharge.amount - o.memberCharge.settledAmount,
                    )}{" "}
                    owed
                  </div>
                )}
                {(o.status === "SOLD" || o.status === "EXCHANGED") &&
                  o.realisedGain != null && (
                  <div
                    className={cn(
                      "text-[11px] font-semibold",
                      o.realisedGain >= 0
                        ? "text-emerald-700 dark:text-emerald-400"
                        : "text-red-700 dark:text-red-400",
                    )}
                  >
                    {o.realisedGain >= 0 ? "+" : "−"}
                    {formatINR(Math.abs(o.realisedGain))}
                  </div>
                )}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "primary" | "destructive";
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-1 text-lg font-semibold tabular-nums",
          tone === "primary" && "text-emerald-700 dark:text-emerald-400",
          tone === "destructive" && "text-red-700 dark:text-red-400",
        )}
      >
        {value}
      </div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
