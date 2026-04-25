"use client";

import { useMemo, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  ArrowLeft,
  TrendingDown,
  ArrowUpRight,
  Trash2,
  BarChart2,
} from "lucide-react";
import { useTransactionDialog } from "@/contexts/transaction-dialog";
import { formatINR, formatDate, cn } from "@/lib/utils";

interface HoldingData {
  id: string;
  name: string;
  symbol: string | null;
  exchange: string | null;
  currency: string | null;
  quantity: number | null;
  purchasePrice: number | null;
  dividends: number | null;
  institution: string | null;
  startedAt: string;
  active: boolean;
  amount: number;
}

interface HoldingTransaction {
  id: string;
  amount: number;
  description: string;
  date: string;
  action: string | null;
  quantity: number | null;
  price: number | null;
  account: { id: string; name: string; kind: string } | null;
  user?: { id: string; name: string };
}

interface DetailResponse {
  investment: HoldingData;
  transactions: HoldingTransaction[];
}

const fetcher = (url: string) => fetch(url).then((r) => (r.ok ? r.json() : null));

function fmtPrice(val: number, currency: string | null) {
  if (currency === "USD")
    return `$${val.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  return formatINR(val);
}

export function StockHoldingDetail({ holdingId }: { holdingId: string }) {
  const router = useRouter();
  const { mutate: globalMutate } = useSWRConfig();
  const { openDialog } = useTransactionDialog();
  const [deletingTxnId, setDeletingTxnId] = useState<string | null>(null);

  const { data, isLoading, mutate: mutateDetail } = useSWR<DetailResponse>(
    `/api/investments/${holdingId}`,
    fetcher
  );

  const holding = data?.investment ?? null;
  const transactions = data?.transactions ?? [];

  async function handleDeleteTransaction(txnId: string) {
    if (!confirm("Delete this transaction? Holdings will be recalculated.")) return;
    setDeletingTxnId(txnId);
    const res = await fetch(`/api/transactions/${txnId}`, { method: "DELETE" });
    setDeletingTxnId(null);
    if (res.ok) {
      toast.success("Transaction deleted");
      mutateDetail();
      globalMutate(
        (k) =>
          typeof k === "string" &&
          (k.startsWith("/api/investments") ||
            k.startsWith("/api/dashboard") ||
            k === "/api/accounts"),
        undefined,
        { revalidate: true }
      );
    } else {
      const d = await res.json().catch(() => ({}));
      toast.error(d.error || "Failed to delete");
    }
  }

  const { buyTxns, sellTxns, totalInvested, realisedPL, realisedPLPct } = useMemo(() => {
    const buys = transactions.filter((t) => t.action === "BUY");
    const sells = transactions.filter((t) => t.action === "SELL");
    const invested = buys.reduce((s, t) => s + t.amount, 0);
    const proceeds = sells.reduce((s, t) => s + t.amount, 0);
    const avgCost = holding?.purchasePrice ?? 0;
    const costOfSold = sells.reduce((s, t) => {
      const qty = t.quantity ?? 0;
      return s + qty * avgCost;
    }, 0);
    const pl = proceeds - costOfSold;
    const plPct = costOfSold > 0 ? (pl / costOfSold) * 100 : null;
    return {
      buyTxns: buys,
      sellTxns: sells,
      totalInvested: invested,
      realisedPL: pl,
      realisedPLPct: plPct,
    };
  }, [transactions, holding]);

  const qty = holding?.quantity ?? 0;
  const avgCost = holding?.purchasePrice ?? 0;
  const cur = holding?.currency ?? "INR";
  const dividends = holding?.dividends ?? 0;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-lg" />
      </div>
    );
  }

  if (!holding) {
    return (
      <div className="space-y-4">
        <Link
          href="/investments/stocks"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to stocks
        </Link>
        <p className="text-sm text-muted-foreground">Holding not found.</p>
      </div>
    );
  }

  const exchangeBadgeColor =
    holding.exchange === "NSE" || holding.exchange === "BSE"
      ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
      : holding.exchange === "NASDAQ" || holding.exchange === "NYSE"
        ? "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300"
        : "bg-muted text-muted-foreground";

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <Link
          href="/investments/stocks"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to stocks
        </Link>

        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
                <BarChart2 className="h-6 w-6" />
                {holding.name}
              </h1>
              {holding.symbol && (
                <span className="text-sm font-mono font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded">
                  {holding.symbol}
                </span>
              )}
              {holding.exchange && (
                <span
                  className={cn(
                    "text-[10px] font-semibold px-2.5 py-1 rounded-full",
                    exchangeBadgeColor
                  )}
                >
                  {holding.exchange}
                </span>
              )}
              <span
                className={cn(
                  "text-[10px] font-semibold px-2.5 py-1 rounded-full",
                  holding.active
                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {holding.active ? "Active" : "Closed"}
              </span>
            </div>
            <p className="text-sm text-muted-foreground mt-2">
              {holding.institution && `${holding.institution} · `}
              Since {formatDate(holding.startedAt)}
            </p>
          </div>

          <div className="flex gap-2">
            <Button onClick={() => openDialog("INVESTMENT")} className="gap-1.5">
              <ArrowUpRight className="h-4 w-4" /> Buy / Sell
            </Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-5 pb-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Quantity
            </p>
            <p className="text-lg font-bold mt-0.5">
              {qty > 0
                ? qty.toLocaleString("en-IN", { maximumFractionDigits: 4 })
                : "—"}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">shares held</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Avg buy price
            </p>
            <p className="text-lg font-bold mt-0.5">
              {avgCost > 0 ? fmtPrice(avgCost, cur) : "—"}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {buyTxns.length} buy transaction{buyTxns.length !== 1 ? "s" : ""}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Total invested
            </p>
            <p className="text-lg font-bold mt-0.5">
              {fmtPrice(totalInvested, cur)}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">cost basis</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Realised P&amp;L
            </p>
            {sellTxns.length > 0 ? (
              <>
                <p
                  className={cn(
                    "text-lg font-bold mt-0.5",
                    realisedPL >= 0
                      ? "text-emerald-700 dark:text-emerald-400"
                      : "text-red-700 dark:text-red-400"
                  )}
                >
                  {realisedPL >= 0 ? "+" : ""}
                  {fmtPrice(realisedPL, cur)}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {realisedPLPct != null
                    ? `${realisedPL >= 0 ? "+" : ""}${realisedPLPct.toFixed(1)}%`
                    : ""}{" "}
                  from {sellTxns.length} sell{sellTxns.length !== 1 ? "s" : ""}
                </p>
              </>
            ) : (
              <>
                <p className="text-lg font-bold text-muted-foreground mt-0.5">—</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">no sells yet</p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {dividends > 0 && (
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Total dividends received
            </p>
            <p className="text-sm font-bold text-amber-600">{fmtPrice(dividends, cur)}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="px-5 pt-5 pb-3 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Transaction history
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {transactions.length} transaction{transactions.length !== 1 ? "s" : ""} recorded
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => openDialog("INVESTMENT")}
              className="gap-1.5"
            >
              <ArrowUpRight className="h-3.5 w-3.5" />
              Record transaction
            </Button>
          </div>

          {transactions.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-muted-foreground">
              No transactions recorded yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-y text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="py-2.5 px-5">Date</th>
                    <th className="py-2.5 px-4">Action</th>
                    <th className="py-2.5 px-4 text-right">Qty</th>
                    <th className="py-2.5 px-4 text-right">Price</th>
                    <th className="py-2.5 px-4 text-right">Amount</th>
                    <th className="py-2.5 px-4">Account</th>
                    <th className="py-2.5 px-4">By</th>
                    <th className="py-2.5 px-4" />
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((t) => {
                    const isBuy = t.action === "BUY";
                    return (
                      <tr key={t.id} className="border-b hover:bg-accent/40 transition-colors">
                        <td className="py-3 px-5 text-xs tabular-nums text-muted-foreground whitespace-nowrap">
                          {formatDate(t.date)}
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={cn(
                              "inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full",
                              isBuy
                                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                                : "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
                            )}
                          >
                            {isBuy ? "BUY" : t.action ?? "—"}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right tabular-nums text-muted-foreground">
                          {t.quantity != null
                            ? t.quantity.toLocaleString("en-IN", {
                                maximumFractionDigits: 4,
                              })
                            : "—"}
                        </td>
                        <td className="py-3 px-4 text-right tabular-nums text-muted-foreground">
                          {t.price != null ? fmtPrice(t.price, cur) : "—"}
                        </td>
                        <td
                          className={cn(
                            "py-3 px-4 text-right font-semibold tabular-nums",
                            isBuy ? "" : "text-emerald-700 dark:text-emerald-400"
                          )}
                        >
                          {isBuy ? "−" : "+"}
                          {fmtPrice(t.amount, cur)}
                        </td>
                        <td className="py-3 px-4 text-xs text-muted-foreground">
                          {t.account?.name ?? "—"}
                        </td>
                        <td className="py-3 px-4 text-xs text-muted-foreground">
                          {t.user?.name ?? "—"}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex gap-1 justify-end">
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label="Delete"
                              onClick={() => handleDeleteTransaction(t.id)}
                              disabled={deletingTxnId === t.id}
                            >
                              <Trash2
                                className={cn(
                                  "h-3.5 w-3.5",
                                  deletingTxnId === t.id && "animate-spin"
                                )}
                              />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {transactions.length > 1 && (
                  <tfoot>
                    <tr className="border-t-2 bg-muted/40 font-semibold text-sm">
                      <td className="py-3 px-5" colSpan={4}>
                        Total invested
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums">
                        {fmtPrice(totalInvested, cur)}
                      </td>
                      <td colSpan={3} />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
