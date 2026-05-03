import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessRecord } from "@/lib/permissions";
import { formatINR, formatDate } from "@/lib/utils";
import {
  amortizationSchedule,
  calculateEMI,
  countPaidEmis,
  loanTotals,
  splitPayment,
  advanceByCycle,
  type LoanFrequency,
} from "@/lib/loan-math";
import {
  LoanBalanceChart,
  type BalancePoint,
} from "@/components/loans/loan-balance-chart";
import {
  LoanPaymentHistory,
  type LoanPaymentRow,
} from "@/components/loans/loan-payment-history";
import { LoanPayButton } from "@/components/loans/loan-pay-dialog";
import { LoanEditButton } from "@/components/loans/loan-edit-button";
import { nextStatementDueDate } from "@/lib/statement-period";
import { TIMING, ONE_DAY_MS } from "@/lib/timing";

const SOURCE_PATH = {
  BANK: "/loans/bank",
  HAND_FORMAL: "/loans/hand",
  CARD_EMI: "/loans/card-emi",
} as const;

const SOURCE_LABEL = {
  BANK: "Bank loans",
  HAND_FORMAL: "Hand loans",
  CARD_EMI: "Card EMI",
} as const;

const FREQUENCY_LABEL = {
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  HALF_YEARLY: "Half-yearly",
  YEARLY: "Yearly",
} as const;

const FREQUENCY_UNIT = {
  MONTHLY: "months",
  QUARTERLY: "quarters",
  HALF_YEARLY: "half-years",
  YEARLY: "years",
} as const;

type ChargeRow = { label: string; amount: number };

export default async function LoanDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  const loan = await prisma.loan.findUnique({
    where: { id },
    include: {
      account: { select: { id: true, name: true } },
      card: {
        select: {
          id: true,
          name: true,
          account: {
            select: { statementDate: true, gracePeriod: true },
          },
        },
      },
      lenderContact: { select: { id: true, name: true } },
      ownerUser: { select: { name: true } },
      goldItems: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!loan || loan.workspaceId !== session?.user.activeWorkspaceId) notFound();
  if (!canAccessRecord(session, loan)) notFound();

  const payments = await prisma.transaction.findMany({
    where: { loanId: id, workspaceId: loan.workspaceId },
    orderBy: { date: "desc" },
    select: {
      id: true,
      type: true,
      kind: true,
      amount: true,
      date: true,
      description: true,
    },
  });

  const principal = Number(loan.principal);
  const outstanding = Number(loan.outstanding);
  const paid = Math.max(0, principal - outstanding);
  const pct = principal > 0 ? Math.min(100, (paid / principal) * 100) : 0;
  const totalRepaid = payments
    .filter((p) => p.type === "EXPENSE")
    .reduce((s, p) => s + Number(p.amount), 0);

  const chargeBreakdown =
    Array.isArray(loan.chargeBreakdown)
      ? (loan.chargeBreakdown as ChargeRow[])
      : [];

  const status = !loan.active
    ? { label: "Closed", tone: "text-muted-foreground" }
    : outstanding === 0
      ? { label: "Cleared", tone: "text-emerald-700 dark:text-emerald-400" }
      : { label: "Active", tone: "text-primary" };

  const sourceKey = loan.source as keyof typeof SOURCE_PATH;
  const freqKey = (loan.frequency ?? "MONTHLY") as keyof typeof FREQUENCY_LABEL;

  // ── Lifetime cost + amortization (only when we have rate + tenure) ────
  const rate = loan.interestRate != null ? Number(loan.interestRate) : 0;
  const gstPct = loan.gstOnInterest != null ? Number(loan.gstOnInterest) : null;
  const tenure = loan.tenure ?? 0;
  const freq = freqKey as LoanFrequency;
  const emi =
    loan.emiAmount != null
      ? Number(loan.emiAmount)
      : calculateEMI(principal, rate, tenure, freq);

  const hasSchedule = rate > 0 && tenure > 0 && emi > 0;
  const fullSchedule = hasSchedule
    ? amortizationSchedule(principal, rate, tenure, freq, gstPct)
    : [];
  const lifetime = hasSchedule
    ? loanTotals(principal, rate, tenure, freq, gstPct)
    : null;
  const cyclesPaid = hasSchedule
    ? countPaidEmis(principal, rate, emi, tenure, freq, outstanding)
    : 0;
  const cyclesRemaining = hasSchedule ? Math.max(0, tenure - cyclesPaid) : 0;
  const interestPaidEst = fullSchedule
    .slice(0, cyclesPaid)
    .reduce((s, r) => s + r.interest + r.gst, 0);
  const interestRemainingEst = lifetime
    ? Math.max(0, lifetime.totalInterest + lifetime.totalGst - interestPaidEst)
    : 0;

  // Forward schedule with projected due dates from startedAt — used in the
  // "Upcoming EMIs" preview. Cap at 12 rows; show a "+ N more" hint below.
  //
  // CREDIT_CARD_LOAN dates follow the linked card's statement+grace cycle
  // (or the loan's own override) instead of a fixed monthly anniversary,
  // so the preview reflects what actually shows up on the card statement.
  const effectiveSd =
    loan.kind === "CREDIT_CARD_LOAN"
      ? loan.loanStatementDate ?? loan.card?.account?.statementDate ?? null
      : null;
  const effectiveGrace =
    loan.kind === "CREDIT_CARD_LOAN"
      ? loan.loanGracePeriod ?? loan.card?.account?.gracePeriod ?? 0
      : 0;
  const useStatementCycle =
    loan.kind === "CREDIT_CARD_LOAN" && effectiveSd != null;
  // Pre-compute due dates by chaining nextStatementDueDate from startedAt
  // up through the last cycle we'll display.
  const statementDueByCycle: Date[] = [];
  if (useStatementCycle && fullSchedule.length > 0) {
    const lastCycleNeeded = Math.min(
      fullSchedule.length,
      cyclesPaid + 12,
    );
    let prev = new Date(loan.startedAt);
    for (let i = 0; i < lastCycleNeeded; i++) {
      const next = nextStatementDueDate(prev, effectiveSd!, effectiveGrace);
      statementDueByCycle.push(next);
      prev = next;
    }
  }
  const upcomingPreview = fullSchedule.slice(cyclesPaid, cyclesPaid + 12).map((r) => ({
    ...r,
    dueDate: useStatementCycle
      ? statementDueByCycle[r.cycle - 1] ?? advanceByCycle(loan.startedAt, freq, r.cycle)
      : advanceByCycle(loan.startedAt, freq, r.cycle),
  }));
  const moreCycles = Math.max(0, cyclesRemaining - upcomingPreview.length);

  // ── Balance over time (for the area chart) ────────────────────────────
  // Walk payments oldest-first, splitting each into principal/interest at
  // the current balance. Falls back to "amount = principal" when no rate.
  const repayments = payments
    .filter((p) => p.type === "EXPENSE")
    .slice()
    .reverse();
  const balanceSeries: BalancePoint[] = [
    {
      date: loan.startedAt.toISOString(),
      label: formatDate(loan.startedAt),
      balance: principal,
    },
  ];
  let runningBalance = principal;
  for (const p of repayments) {
    const amount = Number(p.amount);
    const split =
      rate > 0
        ? splitPayment(runningBalance, rate, amount, freq, gstPct)
        : { principal: Math.min(runningBalance, amount), interest: 0, gst: 0 };
    runningBalance = Math.max(0, runningBalance - split.principal);
    balanceSeries.push({
      date: p.date.toISOString(),
      label: formatDate(p.date),
      balance: runningBalance,
      payment: amount,
    });
  }

  // Grace-window state for the closed-loan banner. Server-component, so
  // `new Date()` is computed once per render on the server.
  const closureGrace =
    !loan.active && loan.foreclosedAt
      ? (() => {
          const ageDays = Math.floor(
            (new Date().getTime() - loan.foreclosedAt.getTime()) / ONE_DAY_MS,
          );
          return {
            ageDays,
            daysLeft: TIMING.loanEmiGraceDays - ageDays,
            inGrace: ageDays <= TIMING.loanEmiGraceDays,
          };
        })()
      : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href={SOURCE_PATH[sourceKey]} className="text-xs text-muted-foreground">
            ← {SOURCE_LABEL[sourceKey]}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {loan.lenderContact?.name ?? loan.lender}
            </h1>
            <span
              className={`text-[10px] font-semibold uppercase tracking-widest ${status.tone}`}
            >
              {status.label}
            </span>
          </div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            {loan.kind} · {SOURCE_LABEL[sourceKey]}
            {loan.borrower ? ` · for ${loan.borrower}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Closed loans are immutable. The only path back to editing is
              reversing the closing EMI within its 3-day grace, which
              re-opens the loan automatically. */}
          {loan.active && (
            <LoanEditButton
              loan={{
                id: loan.id,
                kind: loan.kind,
                source: loan.source,
                lender: loan.lender,
                lenderContact: loan.lenderContact,
                principal,
                outstanding,
                interestRate:
                  loan.interestRate != null ? Number(loan.interestRate) : null,
                gstOnInterest:
                  loan.gstOnInterest != null
                    ? Number(loan.gstOnInterest)
                    : null,
                emiAmount:
                  loan.emiAmount != null ? Number(loan.emiAmount) : null,
                tenure: loan.tenure,
                frequency: (loan.frequency ?? "MONTHLY") as LoanFrequency,
                charges: loan.charges != null ? Number(loan.charges) : null,
                chargeBreakdown: chargeBreakdown.map((c) => ({
                  label: c.label,
                  amount: Number(c.amount) || 0,
                })),
                accountId: loan.accountId,
                cardId: loan.cardId,
                loanAccountNumber: loan.loanAccountNumber,
                loanStatementDate: loan.loanStatementDate,
                loanGracePeriod: loan.loanGracePeriod,
                isExisting: loan.isExisting,
                startedAt: loan.startedAt.toISOString(),
                notes: loan.notes,
                goldItems: loan.goldItems.map((g) => ({
                  name: g.name,
                  quantity: g.quantity,
                  weightGrams: Number(g.weightGrams),
                  purity: g.purity,
                  notes: g.notes,
                })),
              }}
            />
          )}
          {loan.active && outstanding > 0 && (
            <LoanPayButton
              loan={{
                id: loan.id,
                lender: loan.lenderContact?.name ?? loan.lender,
                outstanding,
                emiAmount: loan.emiAmount != null ? Number(loan.emiAmount) : null,
                interestRate:
                  loan.interestRate != null ? Number(loan.interestRate) : null,
                gstOnInterest:
                  loan.gstOnInterest != null ? Number(loan.gstOnInterest) : null,
                frequency: (loan.frequency ?? "MONTHLY") as LoanFrequency,
              }}
            />
          )}
        </div>
      </div>

      {closureGrace && (
        <div
          className={`rounded-lg border p-3 text-sm ${
            closureGrace.inGrace
              ? "border-amber-500/40 bg-amber-500/5 text-amber-900 dark:text-amber-200"
              : "border-border bg-muted/40 text-muted-foreground"
          }`}
        >
          {closureGrace.inGrace ? (
            <>
              <strong className="font-semibold">
                Loan closed{" "}
                {closureGrace.ageDays === 0
                  ? "today"
                  : `${closureGrace.ageDays}d ago`}
                .
              </strong>{" "}
              You have{" "}
              {closureGrace.daysLeft === 0
                ? "until end of day"
                : `${closureGrace.daysLeft} day${closureGrace.daysLeft === 1 ? "" : "s"}`}{" "}
              to edit or delete the closing EMI from the{" "}
              <Link href="/transactions" className="underline">
                transactions list
              </Link>{" "}
              if it was wrong. After that the loan and its history are
              permanent.
            </>
          ) : (
            <>
              <strong className="font-semibold">Loan closed and locked.</strong>{" "}
              The {TIMING.loanEmiGraceDays}-day grace window for the closing EMI
              ended {closureGrace.ageDays - TIMING.loanEmiGraceDays}d ago.
              Changes now require an Owner/Admin override.
            </>
          )}
        </div>
      )}

      <section className="rounded-2xl border bg-linear-to-br from-card to-muted/40 p-5 sm:p-6">
        <div className="grid gap-6 md:grid-cols-[1.4fr_1fr]">
          <div className="flex flex-col justify-between gap-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Outstanding
              </div>
              <div
                className={`mt-1 text-4xl font-bold tabular-nums ${
                  outstanding > 0 ? "text-foreground" : "text-emerald-700 dark:text-emerald-400"
                }`}
              >
                {formatINR(outstanding)}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                {formatINR(paid)} paid of {formatINR(principal)}
              </div>
              {hasSchedule && (
                <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                  {cyclesPaid} of {tenure} EMIs paid
                  {cyclesRemaining > 0 ? ` · ${cyclesRemaining} left` : ""}
                </div>
              )}
            </div>
            <div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
              </div>
              <div className="mt-1.5 text-[11px] text-muted-foreground tabular-nums">
                {pct.toFixed(1)}% repaid
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 sm:gap-4 md:grid-cols-1 md:grid-rows-3">
            <SubStat
              label={
                loan.emiAmount != null ? `${FREQUENCY_LABEL[freqKey]} EMI` : "EMI"
              }
              value={loan.emiAmount != null ? formatINR(Number(loan.emiAmount)) : "—"}
            />
            <SubStat
              label="Interest rate"
              value={
                loan.interestRate != null ? `${Number(loan.interestRate)}% p.a.` : "—"
              }
            />
            <SubStat
              label="Next due"
              value={loan.nextDueDate ? formatDate(loan.nextDueDate) : "—"}
            />
          </div>
        </div>
      </section>

      {lifetime && (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiTile
            label="Total payable"
            value={formatINR(lifetime.totalPayable)}
            hint="Principal + interest"
          />
          <KpiTile
            label="Lifetime interest"
            value={formatINR(lifetime.totalInterest + lifetime.totalGst)}
            hint={
              lifetime.totalGst > 0
                ? `incl. ₹${Math.round(lifetime.totalGst)} GST`
                : `${rate}% p.a.`
            }
            tone="loss"
          />
          <KpiTile
            label="Interest paid"
            value={formatINR(interestPaidEst)}
            hint={cyclesPaid > 0 ? `${cyclesPaid} EMI${cyclesPaid === 1 ? "" : "s"} done` : "No EMIs yet"}
            tone="loss"
          />
          <KpiTile
            label="Interest left"
            value={formatINR(interestRemainingEst)}
            hint={
              cyclesRemaining > 0
                ? `${cyclesRemaining} EMI${cyclesRemaining === 1 ? "" : "s"} left`
                : "Loan complete"
            }
            tone={cyclesRemaining > 0 ? "muted" : "gain"}
          />
        </section>
      )}

      {lifetime &&
        loan.active &&
        outstanding > 0 &&
        interestRemainingEst > 0 && (
          <section className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-4 dark:border-emerald-400/30">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
                  Foreclose now
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Pay off the {formatINR(outstanding)} outstanding today and
                  skip the remaining {cyclesRemaining} EMI
                  {cyclesRemaining === 1 ? "" : "s"}.
                </p>
              </div>
              <div className="text-right">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  You save
                </div>
                <div className="text-2xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                  {formatINR(interestRemainingEst)}
                </div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  in interest
                  {gstPct ? " + GST" : ""}
                </div>
              </div>
            </div>
          </section>
        )}

      {balanceSeries.length >= 2 && (
        <section className="rounded-lg border bg-card p-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">Balance over time</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Outstanding after each repayment
                {rate > 0 ? " (principal split estimated)" : ""}
              </p>
            </div>
            <div className="text-right text-xs text-muted-foreground tabular-nums">
              {formatINR(paid)} of {formatINR(principal)} repaid
            </div>
          </div>
          <div className="mt-3 min-w-0">
            <LoanBalanceChart data={balanceSeries} />
          </div>
        </section>
      )}

      <section className="rounded-lg border bg-card p-5">
        <h2 className="text-sm font-semibold">Loan terms</h2>
        <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Row label="Principal" value={formatINR(principal)} />
          <Row
            label="Tenure"
            value={
              loan.tenure != null
                ? `${loan.tenure} ${FREQUENCY_UNIT[freqKey]}`
                : "—"
            }
          />
          <Row label="Cadence" value={FREQUENCY_LABEL[freqKey]} />
          {loan.gstOnInterest != null && (
            <Row
              label="GST on interest"
              value={`${Number(loan.gstOnInterest)}%`}
            />
          )}
          <Row label="Started on" value={formatDate(loan.startedAt)} />
          {loan.maturityAt && (
            <Row label="Matures on" value={formatDate(loan.maturityAt)} />
          )}
          {loan.foreclosedAt && (
            <Row label="Closed on" value={formatDate(loan.foreclosedAt)} />
          )}
          {loan.account && (
            <Row
              label={loan.source === "BANK" ? "Disbursed into" : "Linked account"}
              value={
                <Link
                  href={`/accounts/${loan.account.id}`}
                  className="underline-offset-2 hover:underline"
                >
                  {loan.account.name}
                </Link>
              }
            />
          )}
          {loan.card && (
            <Row
              label="Credit card"
              value={
                <Link
                  href={`/cards/${loan.card.id}`}
                  className="underline-offset-2 hover:underline"
                >
                  {loan.card.name}
                </Link>
              }
            />
          )}
          {loan.loanAccountNumber && (
            <Row
              label="Loan account no."
              value={
                <span className="font-mono text-xs">
                  {loan.loanAccountNumber}
                </span>
              }
            />
          )}
          {(loan.loanStatementDate != null || loan.loanGracePeriod != null) && (
            <Row
              label="Billing cycle override"
              value={
                <span className="text-xs">
                  {loan.loanStatementDate != null
                    ? `statement on ${loan.loanStatementDate}`
                    : "card default statement"}
                  {loan.loanGracePeriod != null
                    ? ` · ${loan.loanGracePeriod}-day grace`
                    : ""}
                </span>
              }
            />
          )}
          {loan.charges != null && Number(loan.charges) > 0 && (
            <Row label="Upfront charges" value={formatINR(Number(loan.charges))} />
          )}
        </dl>
        {loan.notes && (
          <p className="mt-4 whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-sm">
            {loan.notes}
          </p>
        )}
      </section>

      {chargeBreakdown.length > 0 && (
        <section className="rounded-lg border bg-card p-5">
          <h2 className="text-sm font-semibold">Charge breakdown</h2>
          <table className="mt-3 w-full text-sm">
            <tbody>
              {chargeBreakdown.map((c, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="py-1.5">{c.label}</td>
                  <td className="py-1.5 text-right tabular-nums">
                    {formatINR(Number(c.amount) || 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {loan.kind === "GOLD" && loan.goldItems.length > 0 && (
        <section className="rounded-lg border bg-card p-5">
          <h2 className="text-sm font-semibold">Pledged gold items</h2>
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b">
                <th className="py-2">Name</th>
                <th className="py-2 text-right">Qty</th>
                <th className="py-2 text-right">Weight (g)</th>
                <th className="py-2 text-right">Purity</th>
              </tr>
            </thead>
            <tbody>
              {loan.goldItems.map((g) => (
                <tr key={g.id} className="border-b last:border-0">
                  <td className="py-2">{g.name}</td>
                  <td className="py-2 text-right tabular-nums">{g.quantity}</td>
                  <td className="py-2 text-right tabular-nums">
                    {Number(g.weightGrams).toFixed(3)}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {g.purity != null ? `${g.purity}K` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {upcomingPreview.length > 0 && (
        <section className="rounded-lg border bg-card">
          <header className="px-5 py-3 border-b">
            <h2 className="text-sm font-semibold">Upcoming EMIs</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Reducing-balance schedule from the current outstanding · cycle{" "}
              {cyclesPaid + 1} of {tenure}
            </p>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b bg-muted/30">
                  <th className="px-5 py-2">Cycle</th>
                  <th className="px-5 py-2">Due</th>
                  <th className="px-5 py-2 text-right">Opening</th>
                  <th className="px-5 py-2 text-right">Principal</th>
                  <th className="px-5 py-2 text-right">Interest</th>
                  {gstPct ? <th className="px-5 py-2 text-right">GST</th> : null}
                  <th className="px-5 py-2 text-right">EMI</th>
                  <th className="px-5 py-2 text-right">Closing</th>
                </tr>
              </thead>
              <tbody>
                {upcomingPreview.map((r) => (
                  <tr key={r.cycle} className="border-b last:border-0 hover:bg-muted/20">
                    <td className="px-5 py-2 tabular-nums">{r.cycle}</td>
                    <td className="px-5 py-2 text-muted-foreground whitespace-nowrap tabular-nums">
                      {formatDate(r.dueDate)}
                    </td>
                    <td className="px-5 py-2 text-right tabular-nums">
                      {formatINR(r.opening)}
                    </td>
                    <td className="px-5 py-2 text-right tabular-nums">
                      {formatINR(r.principal)}
                    </td>
                    <td className="px-5 py-2 text-right tabular-nums text-muted-foreground">
                      {formatINR(r.interest)}
                    </td>
                    {gstPct ? (
                      <td className="px-5 py-2 text-right tabular-nums text-muted-foreground">
                        {formatINR(r.gst)}
                      </td>
                    ) : null}
                    <td className="px-5 py-2 text-right tabular-nums font-medium">
                      {formatINR(r.totalPaid)}
                    </td>
                    <td className="px-5 py-2 text-right tabular-nums">
                      {formatINR(r.closing)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {moreCycles > 0 && (
            <p className="border-t px-5 py-2 text-center text-[11px] text-muted-foreground">
              + {moreCycles} more EMI{moreCycles === 1 ? "" : "s"} until maturity
            </p>
          )}
        </section>
      )}

      <LoanPaymentHistory
        payments={payments.map<LoanPaymentRow>((p) => ({
          id: p.id,
          type: p.type,
          kind: p.kind,
          amount: Number(p.amount),
          date: p.date.toISOString(),
          description: p.description,
        }))}
        totalRepaid={totalRepaid}
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-dashed border-border/60 py-1.5 last:border-0">
      <dt className="text-xs uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="text-right tabular-nums">{value}</dd>
    </div>
  );
}

function SubStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-background/60 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function KpiTile({
  label,
  value,
  hint,
  tone = "muted",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "muted" | "gain" | "loss";
}) {
  const valueClass =
    tone === "gain"
      ? "text-emerald-700 dark:text-emerald-400"
      : tone === "loss"
        ? "text-destructive"
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
