"use client";

import { useState, useMemo } from "react";
import useSWR from "swr";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { ConfirmPopover } from "@/components/ui/confirm-popover";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Star,
  ArrowUpRight,
  ArrowDownRight,
  ArrowLeft,
} from "lucide-react";
import { formatINR, cn, groupAccountOptions } from "@/lib/utils";
import { mutateBalances } from "@/lib/mutate-balances";
import type { StockQuote } from "@/app/api/market/quote/route";
import { SymbolSearch } from "@/components/investments/symbol-search";

interface StockHolding {
  id: string;
  name: string;
  institution: string | null;
  amount: number;
  startedAt: string;
  symbol: string | null;
  quantity: number | null;
  purchasePrice: number | null;
  purchaseExchangeRate: number | null;
  dividends: number | null;
  exchange: string | null;
  currency: string | null;
  active: boolean;
}

interface WishlistItem {
  id: string;
  symbol: string;
  name: string | null;
  exchange: string | null;
  targetPrice: string | null;
  notes: string | null;
}

interface HoldingForm {
  name: string;
  symbol: string;
  exchange: string;
  currency: "INR" | "USD";
  quantity: string;
  purchasePrice: string;
  purchaseExchangeRate: string;
  dividends: string;
  institution: string;
  startedAt: string;
}

interface WishlistForm {
  symbol: string;
  name: string;
  exchange: string;
  targetPrice: string;
  notes: string;
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json();
  });

const EXCHANGE_OPTIONS = ["NSE", "BSE", "NASDAQ", "NYSE", "OTHER"];
const EXCHANGE_CURRENCIES: Record<string, "INR" | "USD"> = {
  NSE: "INR",
  BSE: "INR",
  NASDAQ: "USD",
  NYSE: "USD",
  OTHER: "INR",
};

const EXCHANGE_COLORS: Record<string, string> = {
  NSE: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  BSE: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  NASDAQ: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  NYSE: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300",
};

const emptyHoldingForm: HoldingForm = {
  name: "",
  symbol: "",
  exchange: "NSE",
  currency: "INR",
  quantity: "",
  purchasePrice: "",
  purchaseExchangeRate: "",
  dividends: "",
  institution: "",
  startedAt: isoDate(new Date()),
};

const emptyWishlistForm: WishlistForm = {
  symbol: "",
  name: "",
  exchange: "NSE",
  targetPrice: "",
  notes: "",
};

function fmtPrice(price: number, currency: string) {
  if (currency === "USD") {
    return `$${price.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  return `₹${price.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtPct(v: number) {
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

function SummaryCard({
  label,
  value,
  sub,
  positive,
}: {
  label: string;
  value: string;
  sub?: string;
  positive?: boolean;
}) {
  const color =
    positive === undefined
      ? "text-foreground"
      : positive
        ? "text-emerald-700 dark:text-emerald-400"
        : "text-red-700 dark:text-red-400";
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="text-xs">{label}</CardDescription>
        <CardTitle className={`text-xl font-bold ${color}`}>{value}</CardTitle>
        {sub && <p className={`text-xs mt-0.5 ${color}`}>{sub}</p>}
      </CardHeader>
    </Card>
  );
}

type Account = {
  id: string;
  name: string;
  kind: string;
  balance: number;
  availableLimit: number | null;
};

export function StockPortfolio() {
  const router = useRouter();

  const {
    data: holdingsData,
    mutate: mutateHoldings,
    isLoading: holdingsLoading,
  } = useSWR<{ investments: StockHolding[] }>("/api/investments?kind=STOCK", fetcher);
  const holdings = holdingsData?.investments ?? [];

  const {
    data: wishlist,
    mutate: mutateWishlist,
    isLoading: wishlistLoading,
  } = useSWR<WishlistItem[]>("/api/market/wishlist", fetcher);

  const { data: rateData, mutate: mutateRate } = useSWR<{
    rate: number;
    updatedAt: string;
  }>("/api/market/rate", fetcher);
  const usdInrRate = rateData?.rate ?? 84;

  const allSymbols = useMemo(() => {
    const syms = new Set<string>();
    holdings.forEach((h) => h.symbol && syms.add(h.symbol));
    if (Array.isArray(wishlist)) wishlist.forEach((w) => syms.add(w.symbol));
    return [...syms];
  }, [holdings, wishlist]);

  const quotesKey =
    allSymbols.length > 0 ? `/api/market/quote?symbols=${allSymbols.join(",")}` : null;

  const {
    data: quotes,
    mutate: mutateQuotes,
    isLoading: quotesLoading,
  } = useSWR<StockQuote[]>(quotesKey, fetcher, { refreshInterval: 300_000 });

  const quoteMap = useMemo(() => {
    const m = new Map<string, StockQuote>();
    if (Array.isArray(quotes)) quotes.forEach((q) => m.set(q.symbol, q));
    return m;
  }, [quotes]);

  const [quotesLastRefreshed, setQuotesLastRefreshed] = useState<Date | null>(null);

  async function handleRefresh() {
    await Promise.all([mutateQuotes(), mutateRate()]);
    setQuotesLastRefreshed(new Date());
  }

  const { data: accountsData } = useSWR<{ accounts: Account[] }>("/api/accounts", fetcher);
  const accounts = (accountsData?.accounts ?? []).filter((a) => a.kind !== "CARD");

  const [creatingHolding, setCreatingHolding] = useState(false);
  const [editingHoldingId, setEditingHoldingId] = useState<string | null>(null);
  const [holdingForm, setHoldingForm] = useState<HoldingForm>(emptyHoldingForm);
  const [savingHolding, setSavingHolding] = useState(false);
  const [fetchingPrice, setFetchingPrice] = useState(false);
  const [isExisting, setIsExisting] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [pendingFromWishlist, setPendingFromWishlist] = useState(false);

  const [creatingWishlist, setCreatingWishlist] = useState(false);
  const [wishlistForm, setWishlistForm] = useState<WishlistForm>(emptyWishlistForm);
  const [savingWishlist, setSavingWishlist] = useState(false);

  function setHoldingField<K extends keyof HoldingForm>(k: K, v: HoldingForm[K]) {
    setHoldingForm((f) => ({ ...f, [k]: v }));
  }
  function setWishlistField<K extends keyof WishlistForm>(k: K, v: WishlistForm[K]) {
    setWishlistForm((f) => ({ ...f, [k]: v }));
  }

  async function fetchHistoricalRate(date: string): Promise<number | null> {
    try {
      const res = await fetch(`/api/market/rate?from=USD&to=INR&date=${date}`);
      if (!res.ok) return null;
      const data = await res.json();
      return typeof data?.rate === "number" && data.rate > 0 ? data.rate : null;
    } catch {
      return null;
    }
  }

  async function fetchAndFillPrice(sym: string) {
    const cached = quoteMap.get(sym);
    if (cached && cached.price > 0) {
      setHoldingForm((f) => ({ ...f, purchasePrice: cached.price.toFixed(2) }));
      return;
    }
    setFetchingPrice(true);
    try {
      const res = await fetch(`/api/market/quote?symbols=${encodeURIComponent(sym)}`);
      const data: StockQuote[] = await res.json();
      const price = data?.[0]?.price;
      if (price && price > 0) {
        setHoldingForm((f) => ({ ...f, purchasePrice: price.toFixed(2) }));
      }
    } catch {}
    setFetchingPrice(false);
  }

  function startCreateHolding(prefill?: Partial<HoldingForm>) {
    setHoldingForm({ ...emptyHoldingForm, ...prefill });
    setEditingHoldingId(null);
    setCreatingHolding(true);
  }

  function startEditHolding(h: StockHolding) {
    setHoldingForm({
      name: h.name,
      symbol: h.symbol ?? "",
      exchange: h.exchange ?? "NSE",
      currency: (h.currency as "INR" | "USD") ?? "INR",
      quantity: h.quantity != null ? String(h.quantity) : "",
      purchasePrice: h.purchasePrice != null ? String(h.purchasePrice) : "",
      purchaseExchangeRate:
        h.purchaseExchangeRate != null ? String(h.purchaseExchangeRate) : "",
      dividends: h.dividends != null ? String(h.dividends) : "",
      institution: h.institution ?? "",
      startedAt: h.startedAt.slice(0, 10),
    });
    setEditingHoldingId(h.id);
    setCreatingHolding(true);
  }

  function cancelHoldingForm() {
    setCreatingHolding(false);
    setEditingHoldingId(null);
    setHoldingForm(emptyHoldingForm);
    setPendingFromWishlist(false);
    setIsExisting(false);
    setAccountId("");
  }

  async function submitHolding(e: React.FormEvent) {
    e.preventDefault();
    setSavingHolding(true);

    const qty = parseFloat(holdingForm.quantity) || 0;
    const pp = parseFloat(holdingForm.purchasePrice) || 0;
    let resolvedRate = 1;
    if (holdingForm.currency === "USD") {
      const entered = parseFloat(holdingForm.purchaseExchangeRate);
      if (entered > 0) {
        resolvedRate = entered;
      } else {
        const historical = await fetchHistoricalRate(holdingForm.startedAt);
        resolvedRate = historical ?? usdInrRate;
      }
    }
    const invested = qty * pp * resolvedRate;

    const payload: Record<string, unknown> = {
      kind: "STOCK",
      name: holdingForm.name || holdingForm.symbol,
      institution: holdingForm.institution || undefined,
      amount: invested > 0 ? invested : 1,
      startedAt: holdingForm.startedAt,
      symbol: holdingForm.symbol || undefined,
      quantity: holdingForm.quantity ? Number(holdingForm.quantity) : undefined,
      purchasePrice: holdingForm.purchasePrice ? Number(holdingForm.purchasePrice) : undefined,
      purchaseExchangeRate:
        holdingForm.currency === "USD" ? resolvedRate : undefined,
      dividends: holdingForm.dividends ? Number(holdingForm.dividends) : undefined,
      exchange: holdingForm.exchange || undefined,
      currency: holdingForm.currency,
    };
    if (!editingHoldingId) {
      payload.isExisting = isExisting;
      if (accountId) payload.accountId = accountId;
    }

    const url = editingHoldingId
      ? `/api/investments/${editingHoldingId}`
      : "/api/investments";
    const method = editingHoldingId ? "PATCH" : "POST";

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        toast.success(editingHoldingId ? "Holding updated" : "Holding added");
        cancelHoldingForm();
        mutateHoldings();
        mutateQuotes();
        mutateBalances();
      } else {
        const d = await res.json().catch(() => ({}));
        toast.error(d.error || "Failed to save holding");
      }
    } finally {
      setSavingHolding(false);
    }
  }

  async function deleteHolding(id: string) {
    const res = await fetch(`/api/investments/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Holding removed");
      mutateHoldings();
      mutateBalances();
    } else {
      const d = await res.json().catch(() => ({}));
      toast.error(d.error || "Failed");
      throw new Error(d.error || "Failed");
    }
  }

  async function submitWishlist(e: React.FormEvent) {
    e.preventDefault();
    setSavingWishlist(true);
    try {
      const res = await fetch("/api/market/wishlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: wishlistForm.symbol,
          name: wishlistForm.name || undefined,
          exchange: wishlistForm.exchange || undefined,
          targetPrice: wishlistForm.targetPrice || undefined,
          notes: wishlistForm.notes || undefined,
        }),
      });
      if (res.ok) {
        toast.success("Added to watchlist");
        setCreatingWishlist(false);
        setWishlistForm(emptyWishlistForm);
        mutateWishlist();
        mutateQuotes();
      } else {
        const d = await res.json().catch(() => ({}));
        toast.error(d.error || "Failed to save watchlist item");
      }
    } finally {
      setSavingWishlist(false);
    }
  }

  async function deleteWishlist(id: string) {
    const res = await fetch(`/api/market/wishlist/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Removed from watchlist");
      mutateWishlist();
    } else {
      toast.error("Failed");
      throw new Error("Failed");
    }
  }

  function moveToPortfolio(w: WishlistItem) {
    // Fire-and-forget; deleteWishlist now throws on error so swallow
    // the rejection — the toast.error inside already informs the user.
    deleteWishlist(w.id).catch(() => {});
    startCreateHolding({
      symbol: w.symbol,
      name: w.name ?? w.symbol,
      exchange: w.exchange ?? "NSE",
      currency: EXCHANGE_CURRENCIES[w.exchange ?? "NSE"] ?? "INR",
    });
    setPendingFromWishlist(true);
  }

  const portfolioRows = useMemo(() => {
    return holdings.map((h) => {
      const qty = h.quantity ?? 0;
      const pp = h.purchasePrice ?? 0;
      const divs = h.dividends ?? 0;
      const cur = h.currency === "USD" ? "USD" : "INR";
      const liveConversion = cur === "USD" ? usdInrRate : 1;
      const costConversion =
        cur === "USD" ? (h.purchaseExchangeRate ?? usdInrRate) : 1;

      const costInr = qty * pp * costConversion;
      const quote = h.symbol ? quoteMap.get(h.symbol) : undefined;
      const livePrice = quote?.price ?? 0;
      const valueInr = qty * livePrice * liveConversion;
      const capGains = valueInr - costInr;
      const divsInr = divs * liveConversion;
      const totalReturn = costInr > 0 ? ((capGains + divsInr) / costInr) * 100 : 0;
      const dayChange = quote?.change ?? 0;
      const dayChangePct = quote?.changePercent ?? 0;

      return {
        holding: h,
        qty,
        pp,
        divs,
        divsInr,
        cur,
        livePrice,
        valueInr,
        costInr,
        capGains,
        totalReturn,
        dayChange,
        dayChangePct,
        quoteName: quote?.name,
      };
    });
  }, [holdings, quoteMap, usdInrRate]);

  const totalValueInr = portfolioRows.reduce((s, r) => s + r.valueInr, 0);
  const totalCapGains = portfolioRows.reduce((s, r) => s + r.capGains, 0);
  const totalDivs = portfolioRows.reduce((s, r) => s + r.divsInr, 0);
  const totalCostInr = portfolioRows.reduce((s, r) => s + r.costInr, 0);
  const overallReturn =
    totalCostInr > 0 ? ((totalCapGains + totalDivs) / totalCostInr) * 100 : 0;

  const refreshing = quotesLoading;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/investments"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-3"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Investments
        </Link>

        <div className="flex items-end justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
              <TrendingUp className="h-6 w-6" />
              Equity Portfolio
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Live market prices · NSE / BSE / NASDAQ / NYSE · USD/INR conversion
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={refreshing}
              className="gap-1.5"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
              {refreshing ? "Updating…" : "Refresh"}
            </Button>
            {(quotesLastRefreshed || rateData?.updatedAt) && (
              <span className="text-xs text-muted-foreground">
                1 USD = ₹{usdInrRate.toFixed(2)}
                {rateData?.updatedAt && ` · ${rateData.updatedAt}`}
              </span>
            )}
          </div>
        </div>
      </div>

      <Tabs defaultValue="portfolio">
        <TabsList variant="line">
          <TabsTrigger value="portfolio">
            Portfolio {holdings.length ? `(${holdings.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="watchlist">
            <Star className="h-3.5 w-3.5 mr-1" />
            Watchlist {wishlist?.length ? `(${wishlist.length})` : ""}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="portfolio" className="space-y-5 mt-5">
          {portfolioRows.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <SummaryCard label="Portfolio value" value={formatINR(totalValueInr)} />
              <SummaryCard
                label="Capital gains"
                value={`${totalCapGains >= 0 ? "+" : ""}${formatINR(totalCapGains)}`}
                positive={totalCapGains >= 0}
              />
              <SummaryCard
                label="Total return"
                value={fmtPct(overallReturn)}
                sub={`Dividends: ${formatINR(totalDivs)}`}
                positive={overallReturn >= 0}
              />
              <SummaryCard
                label="USD / INR"
                value={`₹${usdInrRate.toFixed(2)}`}
                sub={rateData?.updatedAt ? `as of ${rateData.updatedAt}` : undefined}
              />
            </div>
          )}

          {!creatingHolding && (
            <div className="flex justify-end">
              <Button onClick={() => startCreateHolding()} className="gap-1.5">
                <Plus className="h-4 w-4" />
                Add holding
              </Button>
            </div>
          )}

          {creatingHolding && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {pendingFromWishlist
                    ? "Move from watchlist to portfolio"
                    : editingHoldingId
                      ? "Edit holding"
                      : "Add holding"}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={submitHolding} className="grid sm:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <Label>Ticker symbol *</Label>
                    <SymbolSearch
                      value={holdingForm.symbol}
                      required
                      onChange={(sym, name, exchange) => {
                        setHoldingForm((f) => ({
                          ...f,
                          symbol: sym,
                          name: f.name || name,
                          exchange: exchange || f.exchange,
                          currency: EXCHANGE_CURRENCIES[exchange] ?? f.currency,
                          purchasePrice: "",
                        }));
                        if (!editingHoldingId) fetchAndFillPrice(sym);
                      }}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label>Name (optional)</Label>
                    <Input
                      placeholder="Company name"
                      value={holdingForm.name}
                      onChange={(e) => setHoldingField("name", e.target.value)}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label>Exchange *</Label>
                    <NativeSelect
                      value={holdingForm.exchange}
                      onChange={(ex) =>
                        setHoldingForm((f) => ({
                          ...f,
                          exchange: ex,
                          currency: EXCHANGE_CURRENCIES[ex] ?? "INR",
                        }))
                      }
                      options={EXCHANGE_OPTIONS.map((ex) => ({ value: ex, label: ex }))}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label>Currency</Label>
                    <div className="flex h-9 items-center px-3 rounded-md border bg-muted text-sm text-muted-foreground">
                      {holdingForm.currency} (auto from exchange)
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Quantity (shares) *</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.000001"
                      placeholder="e.g. 10"
                      value={holdingForm.quantity}
                      onChange={(e) => setHoldingField("quantity", e.target.value)}
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label>
                      Avg purchase price ({holdingForm.currency === "USD" ? "$" : "₹"})
                    </Label>
                    <div className="relative">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder={fetchingPrice ? "Fetching price…" : "per share"}
                        value={holdingForm.purchasePrice}
                        onChange={(e) => setHoldingField("purchasePrice", e.target.value)}
                        disabled={fetchingPrice}
                        className="pr-7"
                      />
                      {fetchingPrice && (
                        <div className="absolute right-2 top-1/2 -translate-y-1/2">
                          <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                        </div>
                      )}
                    </div>
                  </div>

                  {holdingForm.currency === "USD" && (
                    <div className="space-y-1.5">
                      <Label>USD/INR rate at purchase</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.0001"
                        placeholder={`auto from ${holdingForm.startedAt}`}
                        value={holdingForm.purchaseExchangeRate}
                        onChange={(e) =>
                          setHoldingField("purchaseExchangeRate", e.target.value)
                        }
                      />
                      <p className="text-[10px] text-muted-foreground">
                        Locks the INR cost basis. Leave blank to fetch the rate
                        for the purchase date.
                      </p>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <Label>
                      Total dividends received ({holdingForm.currency === "USD" ? "$" : "₹"})
                    </Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={holdingForm.dividends}
                      onChange={(e) => setHoldingField("dividends", e.target.value)}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label>Broker / institution</Label>
                    <Input
                      placeholder="Zerodha, Groww…"
                      value={holdingForm.institution}
                      onChange={(e) => setHoldingField("institution", e.target.value)}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label>Purchase date *</Label>
                    <DateInput
                      value={holdingForm.startedAt}
                      onChange={(e) => setHoldingField("startedAt", e.target.value)}
                      required
                    />
                  </div>

                  {!editingHoldingId && (() => {
                    const qty = parseFloat(holdingForm.quantity) || 0;
                    const pp = parseFloat(holdingForm.purchasePrice) || 0;
                    const enteredRate = parseFloat(holdingForm.purchaseExchangeRate);
                    const conv =
                      holdingForm.currency === "USD"
                        ? enteredRate > 0
                          ? enteredRate
                          : usdInrRate
                        : 1;
                    const investedNow = qty * pp * conv;
                    return (
                    <div className="space-y-1.5">
                      <Label>Payment mode</Label>
                      <NativeSelect
                        value={isExisting ? "__existing__" : accountId}
                        onChange={(next) => {
                          if (next === "__existing__") {
                            setIsExisting(true);
                            setAccountId("");
                          } else {
                            setIsExisting(false);
                            setAccountId(next);
                          }
                        }}
                        options={[
                          ...groupAccountOptions(accounts, investedNow),
                          {
                            label: "Other",
                            options: [
                              {
                                value: "__existing__",
                                label: "Already owned (no transaction)",
                              },
                            ],
                          },
                        ]}
                      />
                      {isExisting && (
                        <p className="text-[10px] text-amber-600">
                          No buy transaction will be recorded.
                        </p>
                      )}
                    </div>
                    );
                  })()}

                  <div className="sm:col-span-3 flex gap-2 pt-1">
                    <Button type="submit" disabled={savingHolding}>
                      {savingHolding ? "Saving…" : editingHoldingId ? "Update" : "Add holding"}
                    </Button>
                    <Button type="button" variant="outline" onClick={cancelHoldingForm}>
                      Cancel
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="p-0">
              {holdingsLoading ? (
                <div className="p-6 space-y-3">
                  {[...Array(4)].map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full rounded" />
                  ))}
                </div>
              ) : portfolioRows.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground">
                  No holdings yet. Click &ldquo;Add holding&rdquo; to get started.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                        <th className="py-3 px-4 min-w-[140px]">Symbol / Name</th>
                        <th className="py-3 px-3">Exchange</th>
                        <th className="py-3 px-3 text-right">Qty</th>
                        <th className="py-3 px-3 text-right">Avg cost</th>
                        <th className="py-3 px-3 text-right">Mkt price</th>
                        <th className="py-3 px-3 text-right">Value (₹)</th>
                        <th className="py-3 px-3 text-right">Cap gains</th>
                        <th className="py-3 px-3 text-right">Dividends</th>
                        <th className="py-3 px-3 text-right">Return</th>
                        <th className="py-3 px-3 text-right">Cur</th>
                        <th className="py-3 px-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {portfolioRows.map((row) => {
                        const {
                          holding: h,
                          qty,
                          pp,
                          divsInr,
                          cur,
                          livePrice,
                          valueInr,
                          capGains,
                          totalReturn,
                          dayChange,
                          dayChangePct,
                        } = row;
                        const isProfit = capGains >= 0;
                        const exchange = h.exchange ?? "";
                        const exColor =
                          EXCHANGE_COLORS[exchange] ?? "bg-muted text-muted-foreground";
                        const hasLivePrice = livePrice > 0;
                        const isClosed = !h.active;

                        return (
                          <tr
                            key={h.id}
                            className={cn(
                              "border-b hover:bg-accent/40 transition-colors cursor-pointer",
                              isClosed && "opacity-50"
                            )}
                            onClick={() => router.push(`/investments/stocks/${h.id}`)}
                          >
                            <td className="py-3 px-4">
                              <div className="font-semibold flex items-center gap-2">
                                {h.symbol ?? h.name}
                                {isClosed && (
                                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground uppercase tracking-wider">
                                    Closed
                                  </span>
                                )}
                              </div>
                              {row.quoteName && (
                                <div className="text-[11px] text-muted-foreground leading-tight">
                                  {row.quoteName}
                                </div>
                              )}
                              {h.institution && (
                                <div className="text-[10px] text-muted-foreground">
                                  {h.institution}
                                </div>
                              )}
                            </td>
                            <td className="py-3 px-3">
                              <span
                                className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full ${exColor}`}
                              >
                                {exchange || "—"}
                              </span>
                            </td>
                            <td className="py-3 px-3 text-right tabular-nums">
                              {qty > 0
                                ? qty.toLocaleString("en-IN", { maximumFractionDigits: 6 })
                                : "—"}
                            </td>
                            <td className="py-3 px-3 text-right tabular-nums text-muted-foreground">
                              {pp > 0 ? fmtPrice(pp, cur) : "—"}
                            </td>
                            <td className="py-3 px-3 text-right">
                              {hasLivePrice ? (
                                <div>
                                  <div className="font-semibold tabular-nums">
                                    {fmtPrice(livePrice, cur)}
                                  </div>
                                  <div
                                    className={`text-[11px] flex items-center justify-end gap-0.5 tabular-nums ${
                                      dayChange >= 0
                                        ? "text-emerald-700 dark:text-emerald-400"
                                        : "text-red-700 dark:text-red-400"
                                    }`}
                                  >
                                    {dayChange >= 0 ? (
                                      <ArrowUpRight className="h-3 w-3" />
                                    ) : (
                                      <ArrowDownRight className="h-3 w-3" />
                                    )}
                                    {fmtPct(dayChangePct)}
                                  </div>
                                </div>
                              ) : (
                                <span className="text-muted-foreground text-xs">—</span>
                              )}
                            </td>
                            <td className="py-3 px-3 text-right font-semibold tabular-nums">
                              {valueInr > 0 ? formatINR(valueInr) : "—"}
                            </td>
                            <td className="py-3 px-3 text-right tabular-nums">
                              {valueInr > 0 ? (
                                <span
                                  className={
                                    isProfit
                                      ? "text-emerald-700 dark:text-emerald-400"
                                      : "text-red-700 dark:text-red-400"
                                  }
                                >
                                  {capGains >= 0 ? "+" : ""}
                                  {formatINR(capGains)}
                                </span>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="py-3 px-3 text-right tabular-nums text-emerald-700 dark:text-emerald-400">
                              {divsInr > 0 ? `+${formatINR(divsInr)}` : "—"}
                            </td>
                            <td className="py-3 px-3 text-right">
                              {valueInr > 0 ? (
                                <div className="flex flex-col items-end gap-0.5">
                                  <span
                                    className={`font-semibold tabular-nums ${
                                      totalReturn >= 0
                                        ? "text-emerald-700 dark:text-emerald-400"
                                        : "text-red-700 dark:text-red-400"
                                    }`}
                                  >
                                    {fmtPct(totalReturn)}
                                  </span>
                                  <span
                                    className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                                      isProfit
                                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                                        : "bg-red-50 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                                    }`}
                                  >
                                    {isProfit ? (
                                      <TrendingUp className="h-2.5 w-2.5" />
                                    ) : (
                                      <TrendingDown className="h-2.5 w-2.5" />
                                    )}
                                    {isProfit ? "PROFIT" : "LOSS"}
                                  </span>
                                </div>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="py-3 px-3 text-right text-xs text-muted-foreground">
                              {cur}
                            </td>
                            <td
                              className="py-3 px-3"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="flex gap-1 justify-end">
                                <Button
                                  size="icon-sm"
                                  variant="ghost"
                                  onClick={() => startEditHolding(h)}
                                  aria-label="Edit"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <ConfirmPopover
                                  title="Remove this holding?"
                                  description="The investment record and any linked transactions will be removed."
                                  confirmLabel="Remove"
                                  busyLabel="Removing…"
                                  onConfirm={() => deleteHolding(h.id)}
                                  trigger={
                                    <Button
                                      size="icon-sm"
                                      variant="ghost"
                                      aria-label="Delete"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  }
                                />
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>

                    {portfolioRows.length > 1 && (
                      <tfoot>
                        <tr className="border-t-2 bg-muted/40 font-semibold text-sm">
                          <td className="py-3 px-4" colSpan={5}>
                            Total
                          </td>
                          <td className="py-3 px-3 text-right tabular-nums">
                            {formatINR(totalValueInr)}
                          </td>
                          <td
                            className={`py-3 px-3 text-right tabular-nums ${
                              totalCapGains >= 0
                                ? "text-emerald-700 dark:text-emerald-400"
                                : "text-red-700 dark:text-red-400"
                            }`}
                          >
                            {totalCapGains >= 0 ? "+" : ""}
                            {formatINR(totalCapGains)}
                          </td>
                          <td className="py-3 px-3 text-right tabular-nums text-emerald-700 dark:text-emerald-400">
                            {totalDivs > 0 ? `+${formatINR(totalDivs)}` : "—"}
                          </td>
                          <td
                            className={`py-3 px-3 text-right tabular-nums ${
                              overallReturn >= 0
                                ? "text-emerald-700 dark:text-emerald-400"
                                : "text-red-700 dark:text-red-400"
                            }`}
                          >
                            {fmtPct(overallReturn)}
                          </td>
                          <td colSpan={2} />
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="watchlist" className="space-y-5 mt-5">
          {!creatingWishlist && (
            <div className="flex justify-end">
              <Button onClick={() => setCreatingWishlist(true)} variant="outline" className="gap-1.5">
                <Star className="h-4 w-4" />
                Add to watchlist
              </Button>
            </div>
          )}

          {creatingWishlist && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Add to watchlist</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={submitWishlist} className="grid sm:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <Label>Ticker symbol *</Label>
                    <SymbolSearch
                      value={wishlistForm.symbol}
                      placeholder="e.g. INFY.NS / GOOGL"
                      required
                      onChange={(sym, name, exchange) => {
                        setWishlistForm((f) => ({
                          ...f,
                          symbol: sym,
                          name: f.name || name,
                          exchange: exchange || f.exchange,
                        }));
                      }}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label>Company name</Label>
                    <Input
                      placeholder="Optional"
                      value={wishlistForm.name}
                      onChange={(e) => setWishlistField("name", e.target.value)}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label>Exchange</Label>
                    <NativeSelect
                      value={wishlistForm.exchange}
                      onChange={(next) => setWishlistField("exchange", next)}
                      options={EXCHANGE_OPTIONS.map((ex) => ({ value: ex, label: ex }))}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label>Target price</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Your buy target"
                      value={wishlistForm.targetPrice}
                      onChange={(e) => setWishlistField("targetPrice", e.target.value)}
                    />
                  </div>

                  <div className="space-y-1.5 sm:col-span-2">
                    <Label>Notes</Label>
                    <Input
                      placeholder="Why you're watching this stock"
                      value={wishlistForm.notes}
                      onChange={(e) => setWishlistField("notes", e.target.value)}
                    />
                  </div>

                  <div className="sm:col-span-3 flex gap-2 pt-1">
                    <Button type="submit" disabled={savingWishlist} variant="outline">
                      {savingWishlist ? "Saving…" : "Add to watchlist"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        setCreatingWishlist(false);
                        setWishlistForm(emptyWishlistForm);
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="p-0">
              {wishlistLoading ? (
                <div className="p-6 space-y-3">
                  {[...Array(3)].map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full rounded" />
                  ))}
                </div>
              ) : !wishlist || wishlist.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground">
                  Your watchlist is empty. Add stocks you&apos;re tracking.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                        <th className="py-3 px-4 min-w-[140px]">Symbol</th>
                        <th className="py-3 px-3">Exchange</th>
                        <th className="py-3 px-3 text-right">Current price</th>
                        <th className="py-3 px-3 text-right">Day change</th>
                        <th className="py-3 px-3 text-right">Target price</th>
                        <th className="py-3 px-3 text-right">vs Target</th>
                        <th className="py-3 px-3">Notes</th>
                        <th className="py-3 px-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {wishlist.map((w) => {
                        const quote = quoteMap.get(w.symbol);
                        const livePrice = quote?.price ?? 0;
                        const dayChange = quote?.change ?? 0;
                        const dayChangePct = quote?.changePercent ?? 0;
                        const target = parseFloat(w.targetPrice ?? "0");
                        const vsTarget =
                          target > 0 && livePrice > 0
                            ? ((livePrice - target) / target) * 100
                            : null;
                        const cur = EXCHANGE_CURRENCIES[w.exchange ?? "NSE"] ?? "INR";
                        const exchange = w.exchange ?? "";
                        const exColor =
                          EXCHANGE_COLORS[exchange] ?? "bg-muted text-muted-foreground";

                        return (
                          <tr key={w.id} className="border-b hover:bg-accent/40 transition-colors">
                            <td className="py-3 px-4">
                              <div className="font-semibold">{w.symbol}</div>
                              {(w.name || quote?.name) && (
                                <div className="text-[11px] text-muted-foreground">
                                  {w.name ?? quote?.name}
                                </div>
                              )}
                            </td>
                            <td className="py-3 px-3">
                              <span
                                className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full ${exColor}`}
                              >
                                {exchange || "—"}
                              </span>
                            </td>
                            <td className="py-3 px-3 text-right tabular-nums">
                              {livePrice > 0 ? (
                                <span className="font-semibold">
                                  {fmtPrice(livePrice, cur)}
                                </span>
                              ) : (
                                <span className="text-muted-foreground text-xs">—</span>
                              )}
                            </td>
                            <td className="py-3 px-3 text-right tabular-nums">
                              {livePrice > 0 ? (
                                <span
                                  className={`flex items-center justify-end gap-0.5 ${
                                    dayChange >= 0
                                      ? "text-emerald-700 dark:text-emerald-400"
                                      : "text-red-700 dark:text-red-400"
                                  }`}
                                >
                                  {dayChange >= 0 ? (
                                    <ArrowUpRight className="h-3 w-3" />
                                  ) : (
                                    <ArrowDownRight className="h-3 w-3" />
                                  )}
                                  {fmtPct(dayChangePct)}
                                </span>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="py-3 px-3 text-right tabular-nums text-muted-foreground">
                              {target > 0 ? fmtPrice(target, cur) : "—"}
                            </td>
                            <td className="py-3 px-3 text-right tabular-nums">
                              {vsTarget !== null ? (
                                <span
                                  className={
                                    vsTarget <= 0
                                      ? "text-emerald-700 dark:text-emerald-400"
                                      : "text-orange-600"
                                  }
                                >
                                  {vsTarget <= 0
                                    ? `${Math.abs(vsTarget).toFixed(1)}% below`
                                    : `${vsTarget.toFixed(1)}% above`}
                                </span>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="py-3 px-3 text-muted-foreground text-xs max-w-[160px] truncate">
                              {w.notes || "—"}
                            </td>
                            <td className="py-3 px-3">
                              <div className="flex gap-1 justify-end">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-xs h-7 px-2"
                                  onClick={() => moveToPortfolio(w)}
                                >
                                  <Plus className="h-3 w-3 mr-1" />
                                  Buy
                                </Button>
                                <ConfirmPopover
                                  title="Remove from watchlist?"
                                  confirmLabel="Remove"
                                  busyLabel="Removing…"
                                  onConfirm={() => deleteWishlist(w.id)}
                                  trigger={
                                    <Button
                                      size="icon-sm"
                                      variant="ghost"
                                      aria-label="Delete"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  }
                                />
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {(wishlist?.length ?? 0) > 0 && (
            <p className="text-[11px] text-muted-foreground text-right">
              Prices refresh every 5 minutes · Click &ldquo;Buy&rdquo; to move into your portfolio
            </p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
