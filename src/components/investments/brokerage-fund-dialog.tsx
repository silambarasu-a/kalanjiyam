"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { AmountInput } from "@/components/ui/amount-input";
import { DescriptionField } from "@/components/ui/description-field";
import { FundingSourcePicker } from "@/components/shared/funding-source-picker";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { mutateBalances } from "@/lib/mutate-balances";
import { fundingSourceIds } from "@/lib/funding-sources";
import {
  currencySymbol,
  forexGst,
  formatMoney,
  isForeignCurrency,
  round2,
} from "@/lib/brokerage";
import { cn } from "@/lib/utils";

/** The slice of GET /api/accounts a brokerage wallet dialog needs. */
export type BrokerageWallet = {
  id: string;
  name: string;
  currency: string;
  /** INR book value. */
  balance: number;
  /** Balance in the wallet's own currency. */
  nativeBalance: number;
  /** INR per unit still held — foreign wallets only. */
  avgRate: number | null;
};

export type FundDirection = "deposit" | "withdraw";

const RUPEE_KINDS = ["BANK", "WALLET", "CASH"] as const;

/**
 * Move money between a rupee account and a brokerage wallet.
 *
 * A domestic (INR) wallet is a plain transfer. A foreign-currency one is a
 * conversion: the rupee amount, the rate and the foreign amount are three
 * views of one number, so the form keeps whichever amount the user typed
 * and derives the other from the rate. The rate starts at the day's market
 * rate and stays editable — banks add a markup, and the figure that matters
 * is the one on their advice. Conversions also attract GST, pre-filled from
 * the statutory slab and equally editable; it's booked as a separate
 * expense on the rupee account.
 *
 * Everything posts to /api/transfers, which derives the stored rate from
 * the two amounts rather than trusting the one shown here.
 */
export function BrokerageFundDialog({
  open,
  onClose,
  brokerage,
  direction = "deposit",
}: {
  open: boolean;
  onClose: () => void;
  brokerage: BrokerageWallet | null;
  direction?: FundDirection;
}) {
  return (
    <Dialog open={open && !!brokerage} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        {brokerage && (
          // Keyed so every open starts from a clean form without a reset
          // effect — a different wallet or direction is a different form.
          <FundForm
            key={`${brokerage.id}:${direction}:${open}`}
            brokerage={brokerage}
            initialDirection={direction}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function FundForm({
  brokerage,
  initialDirection,
  onClose,
}: {
  brokerage: BrokerageWallet;
  initialDirection: FundDirection;
  onClose: () => void;
}) {
  const router = useRouter();
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const foreign = isForeignCurrency(brokerage.currency);
  const sym = currencySymbol(brokerage.currency);

  const [direction, setDirection] = useState<FundDirection>(initialDirection);
  const [source, setSource] = useState("");
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Rupee side and wallet side. For an INR wallet only `inr` is used.
  const [inr, setInr] = useState("");
  const [fx, setFx] = useState("");
  const [rate, setRate] = useState("");
  // Which amount the user last typed; the other one follows the rate.
  const [driver, setDriver] = useState<"inr" | "fx">(
    initialDirection === "deposit" ? "inr" : "fx",
  );
  const [rateTouched, setRateTouched] = useState(false);
  const [fetchingRate, setFetchingRate] = useState(false);
  const [rateAsOf, setRateAsOf] = useState<string | null>(null);

  // GST follows the slab until the user types their own figures.
  const [gstAuto, setGstAuto] = useState(true);
  const [cgst, setCgst] = useState("");
  const [sgst, setSgst] = useState("");

  const inrNum = Number(inr) || 0;
  const fxNum = Number(fx) || 0;

  /** Re-derive the amount the user didn't type, for a new rate. */
  function applyRate(nextRate: string, opts?: { inr?: string; fx?: string; by?: "inr" | "fx" }) {
    const r = Number(nextRate) || 0;
    const by = opts?.by ?? driver;
    const inrVal = opts?.inr ?? inr;
    const fxVal = opts?.fx ?? fx;
    if (!(r > 0)) return;
    if (by === "inr") {
      const v = Number(inrVal) || 0;
      setFx(v > 0 ? String(round2(v / r)) : "");
    } else {
      const v = Number(fxVal) || 0;
      setInr(v > 0 ? String(round2(v * r)) : "");
    }
  }

  // Market rate for the chosen date. "Latest" for today — a dated lookup
  // can come back empty until that day's reference rate is published.
  // Skipped once the user has typed a rate of their own.
  const [rateNonce, setRateNonce] = useState(0);
  useEffect(() => {
    if (!foreign || rateTouched) return;
    let cancelled = false;
    // `fresh` bypasses the route's cache so the default really is the
    // latest published rate, not whatever was last cached.
    const qs = new URLSearchParams({ from: brokerage.currency, to: "INR", fresh: "1" });
    if (date && date !== today) qs.set("date", date);
    (async () => {
      setFetchingRate(true);
      try {
        const res = await fetch(`/api/market/rate?${qs.toString()}`);
        const data: { rate?: number; date?: string } = await res.json();
        if (cancelled) return;
        if (res.ok && data.rate && data.rate > 0) {
          const next = data.rate.toFixed(4);
          setRate(next);
          setRateAsOf(data.date ?? null);
          applyRate(next);
        }
      } catch {
        // Offline / provider down — the field stays empty for manual entry.
      } finally {
        if (!cancelled) setFetchingRate(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // applyRate reads the current amounts on purpose; re-running this on
    // every keystroke would refetch the rate while the user types.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foreign, brokerage.currency, date, today, rateTouched, rateNonce]);

  const gstEstimate = useMemo(() => forexGst(inrNum), [inrNum]);
  const cgstNum = !foreign ? 0 : gstAuto ? gstEstimate.cgst : Number(cgst) || 0;
  const sgstNum = !foreign ? 0 : gstAuto ? gstEstimate.sgst : Number(sgst) || 0;
  const gstTotal = round2(cgstNum + sgstNum);

  // What actually moves on the rupee account: the conversion plus GST on
  // the way out, the conversion less GST on the way back.
  const rupeeTotal =
    direction === "deposit" ? round2(inrNum + gstTotal) : round2(inrNum - gstTotal);

  const walletHas = foreign ? brokerage.nativeBalance : brokerage.balance;
  // Only a withdrawal can overdraw. Gated on the direction itself, not on
  // "needs 0": a wallet already in the red (a deposit deleted after it was
  // spent) would otherwise read as overdrawn by a top-up — the one thing
  // that fixes it.
  const walletNeeds = foreign ? fxNum : inrNum;
  const overdrawn = direction === "withdraw" && walletNeeds > walletHas + 0.005;

  function switchDirection(next: FundDirection) {
    setDirection(next);
    setDriver(next === "deposit" ? "inr" : "fx");
    setSource("");
    setError(null);
  }

  async function submit() {
    setError(null);
    const { accountId } = fundingSourceIds(source);
    if (!accountId) {
      setError(direction === "deposit" ? "Pick the account to pay from" : "Pick the account to receive into");
      return;
    }
    if (!(inrNum > 0)) {
      setError("Enter an amount");
      return;
    }
    if (foreign && !(fxNum > 0)) {
      setError(`Enter the ${brokerage.currency} amount`);
      return;
    }
    if (overdrawn) {
      setError(
        `${brokerage.name} has only ${formatMoney(Math.max(0, walletHas), brokerage.currency)}`,
      );
      return;
    }
    if (foreign && direction === "withdraw" && gstTotal >= inrNum) {
      setError("GST can't be more than the amount converted");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/transfers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fromAccountId: direction === "deposit" ? accountId : brokerage.id,
          toAccountId: direction === "deposit" ? brokerage.id : accountId,
          amount: inrNum,
          date,
          notes: notes.trim() || null,
          ...(foreign ? { fx: { amount: fxNum, cgst: cgstNum, sgst: sgstNum } } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Failed");
        return;
      }
      toast.success(
        direction === "deposit"
          ? `Added ${formatMoney(foreign ? fxNum : inrNum, brokerage.currency)} to ${brokerage.name}`
          : `Withdrew ${formatMoney(foreign ? fxNum : inrNum, brokerage.currency)} from ${brokerage.name}`,
      );
      await mutateBalances();
      router.refresh();
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  const rupeeField = (
    <label className="block">
      <span className="text-xs font-medium">
        {direction === "deposit" ? "You convert (₹)" : "You receive (₹)"}
      </span>
      <AmountInput
        value={inr}
        onChange={(v) => {
          setInr(v);
          setDriver("inr");
          applyRate(rate, { inr: v, by: "inr" });
        }}
        placeholder="0"
      />
    </label>
  );
  const walletField = (
    <label className="block">
      <span className="text-xs font-medium">
        {direction === "deposit" ? `Wallet receives (${sym.trim()})` : `Wallet pays out (${sym.trim()})`}
      </span>
      <Input
        type="number"
        inputMode="decimal"
        min="0"
        step="0.01"
        value={fx}
        onChange={(e) => {
          setFx(e.target.value);
          setDriver("fx");
          applyRate(rate, { fx: e.target.value, by: "fx" });
        }}
        placeholder="0.00"
        className={cn(overdrawn && "border-destructive focus-visible:border-destructive")}
      />
    </label>
  );

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {direction === "deposit" ? "Add funds to" : "Withdraw from"} {brokerage.name}
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-3">
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={direction === "deposit" ? "default" : "outline"}
            onClick={() => switchDirection("deposit")}
          >
            Add funds
          </Button>
          <Button
            type="button"
            size="sm"
            variant={direction === "withdraw" ? "default" : "outline"}
            onClick={() => switchDirection("withdraw")}
          >
            Withdraw
          </Button>
          <span className="ml-auto self-center text-xs text-muted-foreground tabular-nums">
            Wallet: {formatMoney(walletHas, brokerage.currency)}
          </span>
        </div>

        <label className="block">
          <span className="text-xs font-medium">
            {direction === "deposit" ? "Pay from" : "Receive into"}
          </span>
          <div className="mt-1">
            <FundingSourcePicker
              value={source}
              onChange={setSource}
              kinds={RUPEE_KINDS}
              direction={direction === "deposit" ? "out" : "in"}
              amount={direction === "deposit" ? rupeeTotal : 0}
              placeholder="Pick an account"
            />
          </div>
        </label>

        {foreign ? (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {direction === "deposit" ? (
                <>
                  {rupeeField}
                  {walletField}
                </>
              ) : (
                <>
                  {walletField}
                  {rupeeField}
                </>
              )}
            </div>

            <div className="rounded-md border border-amber-200 bg-amber-50/50 p-3 space-y-2 dark:border-amber-900/40 dark:bg-amber-950/20">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium">
                  Conversion rate ({brokerage.currency} → INR)
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setRateTouched(false);
                    setRateNonce((n) => n + 1);
                  }}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline disabled:opacity-60"
                  disabled={fetchingRate}
                >
                  <RefreshCw className={cn("h-3 w-3", fetchingRate && "animate-spin")} />
                  {fetchingRate ? "Fetching…" : date === today ? "Latest rate" : "Rate for this date"}
                </button>
              </div>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground">
                  1 {brokerage.currency} = ₹
                </span>
                <Input
                  type="number"
                  inputMode="decimal"
                  step="0.0001"
                  min="0"
                  value={rate}
                  onChange={(e) => {
                    setRate(e.target.value);
                    setRateTouched(true);
                    applyRate(e.target.value);
                  }}
                  placeholder="0.0000"
                  className="pl-24"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                {rateTouched
                  ? "Using the rate you entered."
                  : rateAsOf
                    ? `Market rate as of ${rateAsOf}.`
                    : "Market rate for the day."}{" "}
                Banks add a markup — change it to the rate on your remittance advice.
              </p>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium">GST on the conversion</span>
                {!gstAuto && (
                  <button
                    type="button"
                    onClick={() => setGstAuto(true)}
                    className="text-[11px] font-medium text-primary hover:underline"
                  >
                    Reset to estimate
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-[11px] text-muted-foreground">CGST (₹)</span>
                  <AmountInput
                    value={gstAuto ? (gstEstimate.cgst ? String(gstEstimate.cgst) : "") : cgst}
                    onChange={(v) => {
                      // Leaving auto mode freezes both halves at what was
                      // showing, so editing one doesn't blank the other.
                      if (gstAuto) setSgst(gstEstimate.sgst ? String(gstEstimate.sgst) : "");
                      setGstAuto(false);
                      setCgst(v);
                    }}
                    placeholder="0"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] text-muted-foreground">SGST (₹)</span>
                  <AmountInput
                    value={gstAuto ? (gstEstimate.sgst ? String(gstEstimate.sgst) : "") : sgst}
                    onChange={(v) => {
                      if (gstAuto) setCgst(gstEstimate.cgst ? String(gstEstimate.cgst) : "");
                      setGstAuto(false);
                      setSgst(v);
                    }}
                    placeholder="0"
                  />
                </label>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {gstAuto
                  ? `Estimated at 9% + 9% on the standard forex slab value (${formatMoney(gstEstimate.taxableValue, "INR")}).`
                  : "Using the figures you entered."}{" "}
                Booked as a separate expense under Bank charges.
              </p>
            </div>

            {inrNum > 0 && fxNum > 0 && (
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs space-y-1 tabular-nums">
                <Row
                  label="Converted"
                  value={
                    direction === "deposit"
                      ? `${formatMoney(inrNum, "INR")} → ${formatMoney(fxNum, brokerage.currency)}`
                      : `${formatMoney(fxNum, brokerage.currency)} → ${formatMoney(inrNum, "INR")}`
                  }
                />
                <Row label="GST (CGST + SGST)" value={formatMoney(gstTotal, "INR")} />
                <Row
                  strong
                  label={direction === "deposit" ? "Total leaving your account" : "Net into your account"}
                  value={formatMoney(rupeeTotal, "INR")}
                />
                <Row
                  label={`Effective rate${gstTotal > 0 ? " incl. GST" : ""}`}
                  value={`₹${(rupeeTotal / fxNum).toFixed(4)} per ${brokerage.currency}`}
                />
              </div>
            )}
          </>
        ) : (
          <label className="block">
            <span className="text-xs font-medium">Amount (₹)</span>
            <AmountInput
              value={inr}
              onChange={setInr}
              placeholder="0"
              className={cn(overdrawn && "border-destructive focus-visible:border-destructive")}
            />
          </label>
        )}

        {overdrawn && (
          <p className="text-xs text-destructive">
            {brokerage.name} has only {formatMoney(Math.max(0, walletHas), brokerage.currency)}.
          </p>
        )}

        <label className="block">
          <span className="text-xs font-medium">Date</span>
          <DateInput value={date} onChange={(e) => setDate(e.target.value)} max={today} />
        </label>

        <DescriptionField
          label="Notes"
          rows={2}
          value={notes}
          onChange={setNotes}
          placeholder="Optional — reference no., purpose code…"
          maxLength={200}
        />

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={submitting}>
          {submitting ? "Saving…" : direction === "deposit" ? "Add funds" : "Withdraw"}
        </Button>
      </DialogFooter>
    </>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn("flex items-center justify-between gap-3", strong && "font-semibold")}>
      <span className={cn(!strong && "text-muted-foreground")}>{label}</span>
      <span>{value}</span>
    </div>
  );
}
