"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import useSWR, { mutate as globalMutate } from "swr";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { AmountInput } from "@/components/ui/amount-input";
import { NativeSelect } from "@/components/ui/native-select";
import { DescriptionField } from "@/components/ui/description-field";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { mutateBalances } from "@/lib/mutate-balances";
import { formatINR, formatDate, groupAccountOptions } from "@/lib/utils";
import {
  interestExpectedSince,
  formatInterestCadence,
  type LoanInterestCadence,
} from "@/lib/hand-loan-interest";
import { fetcher } from "@/lib/swr-fetcher";

export type LoanForSettlement = {
  id: string;
  counterparty: string;
  // Bank bullet loans (gold, overdraft) settle through this dialog too, and
  // unlike private lending they always move through an account.
  source: "BANK" | "HAND_FORMAL" | "CARD_EMI";
  direction: "BORROWED" | "LENT";
  outstanding: number;
  principal: number;
  interestRate: number | null;
  interestCadence: LoanInterestCadence | null;
  startedAt: string;
};

type Account = {
  id: string;
  name: string;
  kind: string;
  balance: number;
  availableLimit: number | null;
};

type LedgerEntry = {
  kind: string;
  principalAmount: number;
  interestAmount: number;
  paidAt: string;
  periodTo: string | null;
};

/** Sentinel for the "no account" option — hand loans settle in cash a lot. */
const CASH_IN_HAND = "__cash__";

/**
 * Record an ad-hoc settlement on a hand loan: whatever interest actually
 * changed hands as of a date, plus an optional partial principal reduction.
 *
 * The interest box is NEVER pre-filled. The whole reason this dialog exists is
 * that the amount isn't fixed — a prefilled figure would get saved by accident
 * and silently become "what was agreed". The rate-derived estimate sits beside
 * it as a cross-check, behind an explicit "use this".
 */
export function LoanSettleDialog({
  loan,
  onClose,
  onSaved,
}: {
  loan: LoanForSettlement | null;
  onClose: () => void;
  onSaved?: () => void | Promise<void>;
}) {
  const isLent = loan?.direction === "LENT";
  const { data: accountsData } = useSWR<{ accounts: Account[] }>(
    "/api/accounts",
    fetcher,
  );
  const accounts = (accountsData?.accounts ?? []).filter(
    (a) => a.kind !== "CARD",
  );
  // The loan's own ledger, for the "expected since" estimate and to pre-fill
  // the period start from where the last settlement left off.
  const { data: detail } = useSWR<{ ledger: LedgerEntry[] }>(
    loan ? `/api/loans/${loan.id}` : null,
    fetcher,
  );

  const today = new Date().toISOString().slice(0, 10);
  const [interest, setInterest] = useState("");
  const [principal, setPrincipal] = useState("");
  const [paidAt, setPaidAt] = useState(today);
  const [showPeriod, setShowPeriod] = useState(false);
  const [periodFrom, setPeriodFrom] = useState("");
  const [periodTo, setPeriodTo] = useState("");
  // Cash-in-hand is a private-lending affordance; a bank settlement always
  // debits an account, so it starts unset there and must be picked.
  const cashAllowed = loan?.source !== "BANK";
  const [accountId, setAccountId] = useState(CASH_IN_HAND);
  const [closeLoan, setCloseLoan] = useState(false);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loanId = loan?.id;
  useEffect(() => {
    if (!loanId) return;
    /* eslint-disable react-hooks/set-state-in-effect -- form hydration on dialog open */
    setInterest("");
    setPrincipal("");
    setPaidAt(today);
    setShowPeriod(false);
    setPeriodFrom("");
    setPeriodTo("");
    setAccountId(cashAllowed ? CASH_IN_HAND : "");
    setCloseLoan(false);
    setNotes("");
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loanId]);

  const entries = useMemo(
    () =>
      (detail?.ledger ?? [])
        .filter((e) => e.kind === "REPAYMENT")
        .map((e) => ({
          paidAt: new Date(e.paidAt),
          principalAmount: e.principalAmount,
          interestAmount: e.interestAmount,
          periodTo: e.periodTo ? new Date(e.periodTo) : null,
        })),
    [detail],
  );

  const estimate = useMemo(() => {
    if (!loan) return null;
    return interestExpectedSince({
      startedAt: new Date(loan.startedAt),
      annualRate: loan.interestRate,
      outstanding: loan.outstanding,
      entries,
      asOf: new Date(),
    });
  }, [loan, entries]);

  // Where the last settlement's coverage ended — the natural start of the next
  // period, offered as a prefill only for the period fields (not the amount).
  const suggestedPeriodFrom = estimate?.anchor.toISOString().slice(0, 10) ?? "";

  const interestNum = Number(interest) || 0;
  const principalNum = Number(principal) || 0;
  const gross = interestNum + principalNum;
  const newOutstanding = loan
    ? Math.max(0, Math.round((loan.outstanding - principalNum) * 100) / 100)
    : 0;
  const overPrincipal = !!loan && principalNum > loan.outstanding + 0.01;

  async function submit() {
    if (!loan) return;
    setError(null);
    if (gross <= 0) {
      setError("Enter an interest amount, a principal amount, or both");
      return;
    }
    if (overPrincipal) {
      setError(`Principal exceeds the outstanding (${formatINR(loan.outstanding)})`);
      return;
    }
    if (!cashAllowed && (!accountId || accountId === CASH_IN_HAND)) {
      setError("Pick an account");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/loans/${loan.id}/settle`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          interestAmount: interestNum || null,
          principalAmount: principalNum || null,
          paidAt,
          periodFrom: showPeriod && periodFrom ? periodFrom : null,
          periodTo: showPeriod && periodTo ? periodTo : null,
          accountId: accountId === CASH_IN_HAND ? null : accountId,
          closeLoan: newOutstanding === 0 ? closeLoan : false,
          notes: notes.trim() || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Failed to save");
        return;
      }
      toast.success(
        body.closed
          ? "Loan closed"
          : isLent
            ? "Receipt recorded"
            : "Payment recorded",
      );
      await onSaved?.();
      globalMutate((k) => typeof k === "string" && k.startsWith("/api/loans"));
      await mutateBalances();
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={loan !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(36rem,calc(100%-2rem))]">
        <DialogHeader>
          <DialogTitle>
            {isLent ? "Record a receipt" : "Record a payment"}
          </DialogTitle>
        </DialogHeader>
        {loan && (
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              {isLent ? "Owed to you by" : "Owed by you to"}{" "}
              <strong>{loan.counterparty}</strong>:{" "}
              {formatINR(loan.outstanding)} principal
              {loan.interestRate
                ? ` · ${loan.interestRate}% p.a. ${formatInterestCadence(
                    loan.interestCadence,
                  ).toLowerCase()}`
                : " · interest-free"}
            </div>

            <label className="block">
              <span className="text-xs font-medium">
                Interest {isLent ? "received" : "paid"} (₹)
              </span>
              <AmountInput value={interest} onChange={setInterest} placeholder="0" autoFocus />
              {estimate && estimate.expected > 0 ? (
                <span className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span>
                    ≈ {formatINR(estimate.expected)} expected since{" "}
                    {formatDate(estimate.anchor.toISOString())} (est.)
                  </span>
                  <button
                    type="button"
                    className="underline"
                    onClick={() => setInterest(String(Math.round(estimate.expected)))}
                  >
                    use this
                  </button>
                </span>
              ) : (
                <span className="mt-1 block text-[11px] text-muted-foreground">
                  {loan.interestRate
                    ? "Enter whatever actually changed hands."
                    : "This loan charges no interest."}
                </span>
              )}
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-medium">
                  Principal {isLent ? "received" : "repaid"} (₹)
                </span>
                <AmountInput value={principal} onChange={setPrincipal} placeholder="0" />
                <span className="mt-1 block text-[11px] text-muted-foreground">
                  Optional — reduces the outstanding.
                </span>
              </label>
              <label className="block">
                <span className="text-xs font-medium">Date</span>
                <DateInput value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
              </label>
            </div>

            {showPeriod ? (
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-medium">Period from</span>
                  <DateInput
                    value={periodFrom}
                    onChange={(e) => setPeriodFrom(e.target.value)}
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium">Period to</span>
                  <DateInput
                    value={periodTo}
                    onChange={(e) => setPeriodTo(e.target.value)}
                  />
                  <span className="mt-1 block text-[11px] text-muted-foreground">
                    The next collection date rolls from here.
                  </span>
                </label>
              </div>
            ) : (
              <button
                type="button"
                className="text-[11px] underline text-muted-foreground"
                onClick={() => {
                  setShowPeriod(true);
                  if (!periodFrom) setPeriodFrom(suggestedPeriodFrom);
                  if (!periodTo) setPeriodTo(paidAt);
                }}
              >
                Add the period this covers
              </button>
            )}

            <label className="block">
              <span className="text-xs font-medium">
                {isLent ? "Received into" : "Paid from"}
              </span>
              <div className="mt-1">
                <NativeSelect
                  value={accountId}
                  onChange={setAccountId}
                  options={[
                    // Hand loans are frequently settled in cash. Forcing an
                    // account would either block the entry or push the movement
                    // through a bank balance that never saw it. Its own group
                    // because NativeSelect takes flat OR grouped, not a mix.
                    // A bank settlement always clears through an account, so
                    // the option isn't offered there.
                    ...(cashAllowed
                      ? [
                          {
                            label: "Off-account",
                            options: [
                              { value: CASH_IN_HAND, label: "Cash in hand (no account)" },
                            ],
                          },
                        ]
                      : []),
                    // Only an outgoing settlement can overdraw an account, so
                    // the affordability hint uses the gross only when paying.
                    ...groupAccountOptions(accounts, isLent ? 0 : gross),
                  ]}
                />
              </div>
              {accountId === CASH_IN_HAND && (
                <span className="mt-1 block text-[11px] text-muted-foreground">
                  Recorded against the loan only — no account balance moves.
                </span>
              )}
            </label>

            {gross > 0 && (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs">
                <div className="flex items-center justify-between font-medium text-foreground">
                  <span>{isLent ? "Receiving" : "Paying"} {formatINR(gross)}</span>
                  <span className="tabular-nums">
                    {formatINR(loan.outstanding)} → {formatINR(newOutstanding)}
                  </span>
                </div>
                {principalNum === 0 && (
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Interest only — the principal is unchanged.
                  </p>
                )}
              </div>
            )}

            {newOutstanding === 0 && gross > 0 && (
              <label className="flex items-start gap-2 rounded-lg border p-3">
                <input
                  type="checkbox"
                  checked={closeLoan}
                  onChange={(e) => setCloseLoan(e.target.checked)}
                  className="mt-0.5"
                />
                <span className="text-xs">
                  <span className="font-medium">
                    Interest fully settled — close this loan
                  </span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    Leave unticked if {isLent ? "they still owe you" : "you still owe"}{" "}
                    interest. The loan stays open at zero principal.
                  </span>
                </span>
              </label>
            )}

            <DescriptionField
              value={notes}
              onChange={setNotes}
              label="Notes"
              maxLength={200}
            />
            {overPrincipal && (
              <p className="text-sm text-destructive">
                Principal exceeds the outstanding ({formatINR(loan.outstanding)}).
              </p>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting || gross <= 0 || overPrincipal}>
            {submitting ? "Saving…" : "Record"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Self-contained button + dialog for the loan detail page. Refreshes the
 * server-rendered route on success, and auto-opens on `?settle=1` (used by the
 * dashboard's expected-inflows shortcuts).
 */
export function LoanSettleButton({
  loan,
  className,
}: {
  loan: LoanForSettlement;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [consumed, setConsumed] = useState(false);

  useEffect(() => {
    if (consumed) return;
    if (searchParams.get("settle") !== "1") return;
    /* eslint-disable react-hooks/set-state-in-effect -- one-shot URL trigger */
    setConsumed(true);
    setOpen(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    const params = new URLSearchParams(searchParams.toString());
    params.delete("settle");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [searchParams, consumed, pathname, router]);

  return (
    <>
      <Button onClick={() => setOpen(true)} className={className}>
        {loan.direction === "LENT" ? "Record receipt" : "Record payment"}
      </Button>
      <LoanSettleDialog
        loan={open ? loan : null}
        onClose={() => setOpen(false)}
        onSaved={() => router.refresh()}
      />
    </>
  );
}
