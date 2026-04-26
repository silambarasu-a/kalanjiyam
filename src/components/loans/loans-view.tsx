"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import useSWR, { mutate as globalMutate } from "swr";
import { toast } from "sonner";
import { Plus, Trash2, Landmark, Banknote, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LoanForm, type LoanFormHandle } from "@/components/loans/loan-form";
import { LoanPayDialog } from "@/components/loans/loan-pay-dialog";
import { ConfirmPopover } from "@/components/ui/confirm-popover";
import { formatINR, formatDate } from "@/lib/utils";
import {
  countPaidEmis,
  monthsPerCycle,
  type LoanFrequency,
} from "@/lib/loan-math";
import { MoneyValue, ToneBadge } from "@/components/ui/money-tone";

type GoldItem = {
  id: string;
  name: string;
  quantity: number;
  weightGrams: number;
  purity: number | null;
  notes: string | null;
};

type Loan = {
  id: string;
  kind: string;
  source: "BANK" | "HAND_FORMAL" | "CARD_EMI";
  lender: string;
  principal: number;
  outstanding: number;
  interestRate: number | null;
  gstOnInterest: number | null;
  emiAmount: number | null;
  tenure: number | null;
  frequency: LoanFrequency | null;
  startedAt: string;
  nextDueDate: string | null;
  active: boolean;
  card: { id: string; name: string } | null;
  account: { id: string; name: string } | null;
  goldItems?: GoldItem[];
};

const FREQUENCY_LABEL: Record<LoanFrequency, { tenureUnit: string; emi: string }> = {
  MONTHLY: { tenureUnit: "mo", emi: "monthly" },
  QUARTERLY: { tenureUnit: "qtr", emi: "quarterly" },
  HALF_YEARLY: { tenureUnit: "half-yr", emi: "half-yearly" },
  YEARLY: { tenureUnit: "yr", emi: "yearly" },
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function computeEmiProgress(
  l: Pick<
    Loan,
    "principal" | "outstanding" | "tenure" | "emiAmount" | "interestRate" | "frequency"
  >,
): { paid: number; total: number; left: number } | null {
  if (!l.tenure || !l.emiAmount || l.emiAmount <= 0) return null;
  const rate = l.interestRate ?? 0;
  const freq = l.frequency ?? "MONTHLY";
  const paid =
    rate > 0
      ? countPaidEmis(l.principal, rate, l.emiAmount, l.tenure, freq, l.outstanding)
      : Math.min(
          l.tenure,
          Math.max(0, Math.floor((l.principal - l.outstanding) / l.emiAmount)),
        );
  return { paid, total: l.tenure, left: Math.max(0, l.tenure - paid) };
}

const SOURCE_META = {
  BANK: { label: "Bank loans", Icon: Landmark, emptyHint: "Add your first bank loan." },
  HAND_FORMAL: {
    label: "Hand loans (formal)",
    Icon: Banknote,
    emptyHint: "Formal hand loans with interest and EMI schedule.",
  },
  CARD_EMI: {
    label: "Card EMI",
    Icon: Receipt,
    emptyHint:
      "Convert a credit card purchase to EMI. Principal reduces the card's available limit.",
  },
} as const;

export function LoansView({ source }: { source: "BANK" | "HAND_FORMAL" | "CARD_EMI" }) {
  const meta = SOURCE_META[source];
  const { data, isLoading } = useSWR<{ loans: Loan[] }>(
    `/api/loans?source=${source}`,
    fetcher
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [payLoan, setPayLoan] = useState<Loan | null>(null);
  const loanFormRef = useRef<LoanFormHandle>(null);
  const [loanFormBusy, setLoanFormBusy] = useState(false);

  const allLoans = data?.loans ?? [];
  const activeLoans = allLoans.filter((l) => l.active);
  const closedCount = allLoans.length - activeLoans.length;

  const activeOutstanding = activeLoans.reduce((s, l) => s + l.outstanding, 0);
  const activePrincipal = activeLoans.reduce((s, l) => s + l.principal, 0);
  const activeRepaid = Math.max(0, activePrincipal - activeOutstanding);
  // Normalise EMIs to a monthly figure so loans with mixed frequencies
  // can be compared on a single line.
  const monthlyCommitment = activeLoans.reduce((s, l) => {
    if (l.emiAmount == null) return s;
    const months = monthsPerCycle(l.frequency ?? "MONTHLY");
    return s + l.emiAmount / months;
  }, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{meta.label}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {activeOutstanding > 0
              ? `${formatINR(activeOutstanding)} outstanding across active loans`
              : "No outstanding balance"}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          {source === "CARD_EMI" ? "Convert to EMI" : "New loan"}
        </Button>
      </div>

      {allLoans.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            label="Outstanding"
            value={formatINR(activeOutstanding)}
            hint={
              activePrincipal > 0
                ? `of ${formatINR(activePrincipal)} principal`
                : undefined
            }
            tone={activeOutstanding > 0 ? "outstanding" : "settled"}
          />
          <StatCard
            label="Monthly EMI"
            value={monthlyCommitment > 0 ? formatINR(Math.round(monthlyCommitment)) : "—"}
            hint={
              monthlyCommitment > 0
                ? `across ${activeLoans.length} loan${activeLoans.length === 1 ? "" : "s"}`
                : "No EMI on file"
            }
          />
          <StatCard
            label="Repaid"
            value={formatINR(activeRepaid)}
            hint={
              activePrincipal > 0
                ? `${Math.round((activeRepaid / activePrincipal) * 100)}% of active principal`
                : undefined
            }
            tone="settled"
          />
          <StatCard
            label="Active loans"
            value={String(activeLoans.length)}
            hint={
              closedCount > 0
                ? `${closedCount} closed`
                : allLoans.length > 0
                  ? "All open"
                  : undefined
            }
          />
        </div>
      )}

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {(data?.loans ?? []).map((l) => {
          const paid = l.principal - l.outstanding;
          const pct = l.principal > 0 ? Math.min(100, (paid / l.principal) * 100) : 0;
          const emiProgress = computeEmiProgress(l);
          return (
            <div
              key={l.id}
              className="relative rounded-xl border bg-card p-5 space-y-3 transition-colors hover:bg-muted/30"
            >
              {/* Stretched link covers the full card. Action buttons opt back
                  in via relative+z-10 so they stay clickable. */}
              <Link
                href={`/loans/${l.id}`}
                aria-label={`View ${l.lender}`}
                className="absolute inset-0 z-0 rounded-xl focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
              />
              <div className="relative flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <meta.Icon className="h-4 w-4 text-primary shrink-0" />
                    <h3 className="truncate font-semibold">{l.lender}</h3>
                    {!l.active && (
                      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                        closed
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {l.kind} · started {formatDate(l.startedAt)}
                    {l.card ? ` · on ${l.card.name}` : ""}
                    {l.tenure
                      ? ` · ${l.tenure}${FREQUENCY_LABEL[l.frequency ?? "MONTHLY"].tenureUnit}`
                      : ""}
                  </div>
                  {l.kind === "GOLD" && l.goldItems && l.goldItems.length > 0 && (
                    <div className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
                      {l.goldItems.reduce((s, g) => s + g.quantity, 0)} gold item(s) ·{" "}
                      {l.goldItems
                        .reduce((s, g) => s + g.weightGrams * g.quantity, 0)
                        .toFixed(3)}{" "}
                      g pledged
                    </div>
                  )}
                </div>
                <div className="relative z-10 flex gap-1">
                  {l.active && (
                    <Button size="sm" variant="outline" onClick={() => setPayLoan(l)}>
                      Pay
                    </Button>
                  )}
                  <ConfirmPopover
                    title={`Delete "${l.lender}"?`}
                    description="The loan and its payment history will be removed. This cannot be undone."
                    confirmLabel="Delete"
                    busyLabel="Deleting…"
                    onConfirm={async () => {
                      const res = await fetch(`/api/loans/${l.id}`, {
                        method: "DELETE",
                      });
                      if (!res.ok) {
                        const body = await res.json().catch(() => ({}));
                        toast.error(body.error ?? "Failed");
                        throw new Error(body.error ?? "Failed");
                      }
                      toast.success("Loan deleted");
                      globalMutate(`/api/loans?source=${source}`);
                    }}
                    trigger={
                      <Button variant="ghost" size="icon" aria-label="Delete">
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    }
                  />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Outstanding</span>
                    <ToneBadge
                      tone={l.outstanding > 0 ? "outstanding" : "settled"}
                      label={l.outstanding > 0 ? "Active" : "Cleared"}
                    />
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    {formatINR(paid)} paid of {formatINR(l.principal)}
                  </span>
                </div>
                <MoneyValue
                  tone={l.outstanding > 0 ? "outstanding" : "settled"}
                  value={formatINR(l.outstanding)}
                  className="text-2xl font-semibold mt-1"
                  icon={false}
                />
                <div className="mt-2 h-1.5 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
              {l.emiAmount != null && (
                <div className="text-xs text-muted-foreground">
                  {FREQUENCY_LABEL[l.frequency ?? "MONTHLY"].emi[0].toUpperCase() +
                    FREQUENCY_LABEL[l.frequency ?? "MONTHLY"].emi.slice(1)}{" "}
                  EMI {formatINR(l.emiAmount)}
                  {l.interestRate ? ` · ${l.interestRate}% p.a.` : ""}
                </div>
              )}
              {emiProgress && (
                <div className="text-[11px] text-muted-foreground tabular-nums">
                  {emiProgress.paid} of {emiProgress.total} EMIs paid
                  {l.active && emiProgress.left > 0
                    ? ` · ${emiProgress.left} left`
                    : ""}
                </div>
              )}
            </div>
          );
        })}
        {(data?.loans ?? []).length === 0 && !isLoading && (
          <div className="col-span-full rounded-xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
            {meta.emptyHint}
          </div>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={(o) => !o && setCreateOpen(false)}>
        <DialogContent className="w-[min(36rem,calc(100%-2rem))]">
          <DialogHeader>
            <DialogTitle>
              {source === "CARD_EMI" ? "Convert a purchase to EMI" : "New loan"}
            </DialogTitle>
          </DialogHeader>
          <LoanForm
            ref={loanFormRef}
            source={source}
            onSaved={() => setCreateOpen(false)}
            onSubmittingChange={setLoanFormBusy}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => loanFormRef.current?.submit()} disabled={loanFormBusy}>
              {loanFormBusy ? "Saving…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <LoanPayDialog
        loan={payLoan}
        onClose={() => setPayLoan(null)}
        onPaid={() => globalMutate(`/api/loans?source=${source}`)}
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  tone = "muted",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "muted" | "outstanding" | "settled";
}) {
  const valueClass =
    tone === "outstanding"
      ? "text-foreground"
      : tone === "settled"
        ? "text-emerald-700 dark:text-emerald-400"
        : "";
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${valueClass}`}>
        {value}
      </div>
      {hint && (
        <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>
      )}
    </div>
  );
}
