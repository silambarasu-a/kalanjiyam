"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { AmountInput } from "@/components/ui/amount-input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { mutateBalances } from "@/lib/mutate-balances";
import { formatINR, groupAccountOptions } from "@/lib/utils";
import {
  splitPayment,
  cyclesPerYear,
  type LoanFrequency,
} from "@/lib/loan-math";
import { TIMING } from "@/lib/timing";

export type LoanForPayment = {
  id: string;
  lender: string;
  outstanding: number;
  emiAmount: number | null;
  interestRate: number | null;
  gstOnInterest: number | null;
  frequency: LoanFrequency | null;
};

type Account = {
  id: string;
  name: string;
  kind: string;
  balance: number;
  availableLimit: number | null;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function LoanPayDialog({
  loan,
  onClose,
  onPaid,
}: {
  loan: LoanForPayment | null;
  onClose: () => void;
  onPaid?: () => void | Promise<void>;
}) {
  const { data: accountsData } = useSWR<{ accounts: Account[] }>(
    "/api/accounts",
    fetcher,
  );
  const accounts = (accountsData?.accounts ?? []).filter(
    (a) => a.kind !== "CARD",
  );

  const today = new Date().toISOString().slice(0, 10);
  const [amount, setAmount] = useState("");
  const [overrideSplit, setOverrideSplit] = useState(false);
  const [principalPortion, setPrincipalPortion] = useState("");
  const [interestPortion, setInterestPortion] = useState("");
  const [gstPortion, setGstPortion] = useState("");
  const [paidAt, setPaidAt] = useState(today);
  const [accountId, setAccountId] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pre-fill the amount when the dialog opens so a one-tap "Confirm"
  // posts the standard EMI. Capped at outstanding so the last (smaller)
  // EMI doesn't overpay.
  const loanId = loan?.id;
  useEffect(() => {
    if (!loanId || !loan) return;
    const suggested = Math.round(
      loan.emiAmount != null
        ? Math.min(loan.emiAmount, loan.outstanding)
        : loan.outstanding,
    );
    setAmount(suggested > 0 ? String(suggested) : "");
    setOverrideSplit(false);
    setPrincipalPortion("");
    setInterestPortion("");
    setGstPortion("");
    setNotes("");
    setError(null);
    setPaidAt(today);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loanId]);

  const amt = Number(amount) || (loan?.emiAmount ?? 0);
  const freq: LoanFrequency = loan?.frequency ?? "MONTHLY";
  const suggestion =
    loan && amt > 0
      ? splitPayment(
          loan.outstanding,
          loan.interestRate ?? 0,
          Math.min(loan.emiAmount ?? amt, amt),
          freq,
          loan.gstOnInterest ?? null,
        )
      : { interest: 0, principal: 0, gst: 0 };
  const suggestedPrincipal = Math.max(
    0,
    Math.round((amt - suggestion.interest - suggestion.gst) * 100) / 100,
  );

  async function submit() {
    if (!loan) return;
    setError(null);
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      setError("Enter an amount");
      return;
    }
    if (!accountId) {
      setError("Pick an account");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/loans/${loan.id}/pay`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amount: amt,
          paidAt,
          accountId,
          principalPortion:
            overrideSplit && principalPortion ? Number(principalPortion) : null,
          interestPortion:
            overrideSplit && interestPortion ? Number(interestPortion) : null,
          gstPortion:
            overrideSplit && gstPortion ? Number(gstPortion) : null,
          notes: notes.trim() || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) setError(body.error ?? "Failed");
      else {
        // Surface the 3-day grace window when this payment closed the
        // loan — it's the user's only chance to undo a wrong final
        // amount before the row goes immutable.
        if (body.outstanding === 0) {
          toast.success("Loan closed", {
            description: `You have ${TIMING.loanEmiGraceDays} days to edit or delete this final EMI from the transactions list if needed.`,
          });
        } else {
          toast.success("EMI paid");
        }
        await onPaid?.();
        await mutateBalances();
        onClose();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={loan !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(36rem,calc(100%-2rem))]">
        <DialogHeader>
          <DialogTitle>Record EMI payment</DialogTitle>
        </DialogHeader>
        {loan && (
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              Outstanding on <strong>{loan.lender}</strong>:{" "}
              {formatINR(loan.outstanding)}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-medium">Total paid (₹)</span>
                <AmountInput
                  value={amount}
                  onChange={setAmount}
                  placeholder={
                    loan.emiAmount != null
                      ? String(Math.round(loan.emiAmount))
                      : "EMI amount"
                  }
                  autoFocus
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium">Date</span>
                <DateInput
                  value={paidAt}
                  onChange={(e) => setPaidAt(e.target.value)}
                />
              </label>
            </div>
            {amt > 0 && (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs space-y-1.5">
                <div className="flex items-center justify-between font-medium text-foreground">
                  <span>Auto-split (reducing balance)</span>
                  <button
                    type="button"
                    className="text-[11px] font-normal underline text-muted-foreground"
                    onClick={() => setOverrideSplit((v) => !v)}
                  >
                    {overrideSplit ? "Use auto-split" : "Override"}
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Principal</span>
                  <span className="tabular-nums">
                    {formatINR(suggestedPrincipal)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Interest</span>
                  <span className="tabular-nums">
                    {formatINR(suggestion.interest)}
                  </span>
                </div>
                {suggestion.gst > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      GST on interest
                    </span>
                    <span className="tabular-nums">
                      {formatINR(suggestion.gst)}
                    </span>
                  </div>
                )}
                <p className="text-[10px] text-muted-foreground pt-1">
                  Interest = outstanding ×{" "}
                  {((loan.interestRate ?? 0) / cyclesPerYear(freq)).toFixed(3)}%
                  {suggestion.gst > 0
                    ? ` + GST ${loan.gstOnInterest}%`
                    : ""}
                  . Remaining is principal.
                </p>
              </div>
            )}

            {overrideSplit && (
              <div className="grid grid-cols-3 gap-2">
                <label className="block">
                  <span className="text-xs font-medium">Principal</span>
                  <AmountInput
                    value={principalPortion}
                    onChange={setPrincipalPortion}
                    placeholder={String(suggestedPrincipal)}
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium">Interest</span>
                  <AmountInput
                    value={interestPortion}
                    onChange={setInterestPortion}
                    placeholder={String(suggestion.interest)}
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium">GST</span>
                  <AmountInput
                    value={gstPortion}
                    onChange={setGstPortion}
                    placeholder={String(suggestion.gst)}
                  />
                </label>
              </div>
            )}
            <label className="block">
              <span className="text-xs font-medium">Pay from</span>
              <div className="mt-1">
                <NativeSelect
                  value={accountId}
                  onChange={setAccountId}
                  options={groupAccountOptions(accounts, amt)}
                />
              </div>
            </label>
            <label className="block">
              <span className="text-xs font-medium">Notes</span>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={200}
              />
            </label>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Self-contained Pay button + dialog for use on the loan detail page.
 * Refreshes the server-rendered route on success so the page picks up
 * the new outstanding, schedule, and payment history. Also auto-opens
 * when the page is loaded with `?pay=1` (used by Pay shortcuts on the
 * dashboard / notifications dues lists).
 */
export function LoanPayButton({
  loan,
  className,
}: {
  loan: LoanForPayment;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [consumed, setConsumed] = useState(false);

  useEffect(() => {
    if (consumed) return;
    if (searchParams.get("pay") !== "1") return;
    /* eslint-disable react-hooks/set-state-in-effect -- one-shot URL trigger */
    setConsumed(true);
    setOpen(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    const params = new URLSearchParams(searchParams.toString());
    params.delete("pay");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [searchParams, consumed, pathname, router]);

  return (
    <>
      <Button onClick={() => setOpen(true)} className={className}>
        Pay EMI
      </Button>
      <LoanPayDialog
        loan={open ? loan : null}
        onClose={() => setOpen(false)}
        onPaid={() => router.refresh()}
      />
    </>
  );
}
