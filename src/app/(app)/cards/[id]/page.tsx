import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessRecord } from "@/lib/permissions";
import { computeAccountBalance } from "@/lib/account-balance";
import { computeAccountAvailableLimit } from "@/lib/card-available-limit";
import {
  materializeStatementsFor,
  untaggedPaymentsToCard,
} from "@/lib/card-statement-service";
import { formatINR, formatDate } from "@/lib/utils";
import {
  calendarMonthPeriods,
  cardStatementPeriods,
  parsePeriodId,
  rangeToPrismaFilter,
  type Period,
} from "@/lib/statement-period";
import { PeriodFilter } from "@/components/transactions/period-filter";
import {
  CardSpendChart,
  type CardSpendBucket,
} from "@/components/cards/card-spend-chart";
import {
  CategoryBreakdown,
  type CategorySlice,
} from "@/components/cards/category-breakdown";
import {
  PayBillButton,
  PayBillAutoOpener,
} from "@/components/cards/card-bill-payer";

export default async function CardDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const session = await auth();
  const card = await prisma.card.findUnique({
    where: { id },
    include: {
      ownerUser: { select: { name: true } },
      ownerContact: { select: { name: true } },
      parentAccount: { select: { id: true, name: true } },
      parentCard: { select: { id: true, name: true } },
      account: {
        select: {
          id: true,
          creditLimit: true,
          statementDate: true,
          gracePeriod: true,
          nextBillDue: true,
          nextBillAmount: true,
        },
      },
    },
  });
  if (!card || card.workspaceId !== session?.user.activeWorkspaceId) notFound();
  if (!canAccessRecord(session, card)) notFound();

  // ── CREDIT-only metrics ──────────────────────────────────────────────
  const isCredit = card.kind === "CREDIT";
  // Lazy-materialise any past statement records so the page always shows
  // an accurate per-bill ledger. Idempotent — only writes new rows for
  // cycles that have closed since the last visit.
  if (isCredit && card.accountId) {
    await materializeStatementsFor(card.accountId);
  }
  const balance =
    isCredit && card.accountId ? await computeAccountBalance(card.accountId) : null;
  const isSharedChild = card.limitMode === "SHARED" && card.parentCardId;
  let effectiveLimit: number | null = null;
  if (isCredit) {
    if (isSharedChild) {
      const parentAcc = await prisma.card.findUnique({
        where: { id: card.parentCardId! },
        select: { account: { select: { creditLimit: true } } },
      });
      effectiveLimit =
        parentAcc?.account?.creditLimit != null
          ? Number(parentAcc.account.creditLimit)
          : null;
    } else {
      effectiveLimit =
        card.account?.creditLimit != null ? Number(card.account.creditLimit) : null;
    }
  }
  // ── Statement due / last-paid (CREDIT only) ─────────────────────────
  // The "Closes on" stat is forward-looking — the date the *current open*
  // cycle will close (when the next bill gets generated). Payment-due and
  // amount-due come from the most recent UNPAID CardStatement (already
  // materialised above) so the amount only reflects the closed-but-unpaid
  // bill, excluding spending that's racked up in the still-open cycle.
  const stmtDay = card.account?.statementDate ?? null;
  const grace = card.account?.gracePeriod ?? null;
  let statementClosesOn: Date | null = null;
  if (isCredit && stmtDay) {
    const today = new Date();
    const ty = today.getUTCFullYear();
    const tm = today.getUTCMonth();
    const td = today.getUTCDate();
    const closeY = ty;
    let closeM = tm;
    if (td > stmtDay) closeM += 1;
    const monthLastDay = new Date(Date.UTC(closeY, closeM + 1, 0)).getUTCDate();
    statementClosesOn = new Date(Date.UTC(closeY, closeM, Math.min(stmtDay, monthLastDay)));
  }
  // Resolve "payment due by" + "amount due" with a 3-tier fallback:
  //   1. Account.nextBillDue + nextBillAmount — explicit manual override
  //      captured at card onboarding (e.g. for an existing card whose
  //      first cycle pre-dates the app).
  //   2. Oldest unpaid CardStatement — the auto-managed source of truth
  //      once cycles start closing. Outstanding = totalDue − tagged
  //      payments.
  //   3. Compute from balance + statementDate + gracePeriod when neither
  //      exists yet (e.g. card just added with openingBalance, no
  //      transactions, no statement materialised). Bill = current balance
  //      minus charges since the most recent close.
  const upcomingStatement =
    isCredit && card.accountId
      ? await prisma.cardStatement.findFirst({
          where: { accountId: card.accountId, paidAt: null },
          orderBy: { dueDate: "asc" },
          select: {
            id: true,
            dueDate: true,
            totalDue: true,
            payments: { select: { amount: true } },
          },
        })
      : null;

  let paymentDueBy: Date | null = null;
  let amountDueNow = 0;
  // Original bill total + cumulative paid for the active bill, so the UI
  // can show "₹X due of ₹Y · ₹Z paid" when a partial payment has been made.
  // Null when there's no active bill at all.
  let billTotal: number | null = null;
  let billPaidSoFar = 0;

  const manualBillDue = card.account?.nextBillDue ?? null;
  const manualBillAmount =
    card.account?.nextBillAmount != null
      ? Number(card.account.nextBillAmount)
      : null;
  if (manualBillDue && manualBillAmount != null && manualBillAmount > 0) {
    paymentDueBy = manualBillDue;
    // Subtract untagged transfers landing on this card account up to the
    // manual due date — there's no CardStatement row to tag against, so
    // payments toward the override are tracked via this fallback.
    const paidUntagged = card.accountId
      ? await untaggedPaymentsToCard(card.accountId, manualBillDue)
      : 0;
    billTotal = manualBillAmount;
    billPaidSoFar = Math.min(manualBillAmount, paidUntagged);
    amountDueNow = Math.max(0, manualBillAmount - paidUntagged);
  } else if (upcomingStatement) {
    paymentDueBy = upcomingStatement.dueDate;
    const total = Number(upcomingStatement.totalDue);
    const paid = upcomingStatement.payments.reduce(
      (s, p) => s + Number(p.amount),
      0,
    );
    billTotal = total;
    billPaidSoFar = Math.min(total, paid);
    amountDueNow = Math.max(0, total - paid);
  } else if (isCredit && stmtDay && card.accountId && balance) {
    // Fallback compute. Most recent close = sd of this month if today is
    // past sd, otherwise sd of previous month. Due = close + grace.
    const today = new Date();
    const ty = today.getUTCFullYear();
    const tm = today.getUTCMonth();
    const td = today.getUTCDate();
    let closeY = ty;
    let closeM = tm;
    if (td < stmtDay) {
      closeM -= 1;
      if (closeM < 0) {
        closeM = 11;
        closeY -= 1;
      }
    }
    const monthLastDay = new Date(
      Date.UTC(closeY, closeM + 1, 0),
    ).getUTCDate();
    const lastClose = new Date(
      Date.UTC(closeY, closeM, Math.min(stmtDay, monthLastDay)),
    );
    paymentDueBy = new Date(lastClose.getTime() + (grace ?? 0) * 86400000);
    // amount_due = balance_now − charges_after_last_close (payments after
    // close cancel out algebraically — see derivation in PR description).
    // Mirror the card-balance "owed" definition: EXPENSE + INVESTMENT BUY.
    // Without INVESTMENT, a gold/jewel buy posted after close sits in
    // `balance` but isn't subtracted out, inflating the just-closed bill.
    const chargesAfterClose = await prisma.transaction.aggregate({
      where: {
        accountId: card.accountId,
        date: { gt: lastClose },
        OR: [
          { type: "EXPENSE", transferId: null },
          { type: "INVESTMENT", investmentAction: "BUY", transferId: null },
        ],
      },
      _sum: { amount: true },
    });
    amountDueNow = Math.max(
      0,
      balance.balance - Number(chargesAfterClose._sum.amount ?? 0),
    );
  }
  const lastPayment =
    isCredit && card.accountId
      ? await prisma.transfer.findFirst({
          where: { toAccountId: card.accountId, workspaceId: card.workspaceId },
          orderBy: { date: "desc" },
          select: { id: true, amount: true, date: true, fromAccount: { select: { name: true } } },
        })
      : null;

  // Pull all EMIs (active + closed) on this card so we can render both lists
  // and aggregate the active outstanding for the hero stat.
  const emiLoans = isCredit
    ? await prisma.loan.findMany({
        where: { cardId: id, source: "CARD_EMI" },
        orderBy: [{ active: "desc" }, { startedAt: "desc" }],
        select: {
          id: true,
          lender: true,
          principal: true,
          outstanding: true,
          emiAmount: true,
          tenure: true,
          startedAt: true,
          maturityAt: true,
          nextDueDate: true,
          foreclosedAt: true,
          active: true,
        },
      })
    : [];
  const activeEmiLoans = emiLoans.filter((l) => l.active);
  const closedEmiLoans = emiLoans.filter((l) => !l.active);
  const outstandingEmi = activeEmiLoans.reduce((s, l) => s + Number(l.outstanding), 0);
  const totalEmiPaid = closedEmiLoans.reduce((s, l) => s + Number(l.principal), 0);
  const available =
    isCredit && card.accountId ? await computeAccountAvailableLimit(card.accountId) : null;

  // ── Statements ledger (CREDIT only) ─────────────────────────────────
  // Closed billing cycles archived by `materializeStatementsFor`. Each
  // row carries totalDue + dueDate + the list of payments tagged to it
  // so the user can see "I paid this bill in 2 instalments on these
  // dates" rather than just a flat transfer history.
  const statements =
    isCredit && card.accountId
      ? await prisma.cardStatement.findMany({
          where: { accountId: card.accountId },
          orderBy: { periodEnd: "desc" },
          take: 24,
          include: {
            payments: {
              orderBy: { date: "asc" },
              select: {
                id: true,
                amount: true,
                date: true,
                fromAccount: { select: { id: true, name: true } },
                fromContact: { select: { id: true, name: true } },
                notes: true,
              },
            },
          },
        })
      : [];

  // ── DEBIT-only metric: linked bank balance ───────────────────────────
  const linkedBalance =
    !isCredit && card.parentAccountId
      ? await computeAccountBalance(card.parentAccountId)
      : null;

  // ── Period filter ────────────────────────────────────────────────────
  const statementDay = isCredit ? card.account?.statementDate ?? null : null;
  const periods: Period[] =
    isCredit && statementDay ? cardStatementPeriods(statementDay) : calendarMonthPeriods();

  let activeId = sp.period ?? periods[0]?.id ?? "";
  let activeRange: { start: Date; end: Date } | null = null;
  if (activeId === "custom") {
    if (sp.from && sp.to) {
      const start = new Date(`${sp.from}T00:00:00Z`);
      const end = new Date(`${sp.to}T00:00:00Z`);
      if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
        activeRange = { start, end };
      }
    }
  } else {
    const parsed = parsePeriodId(activeId);
    if (parsed) activeRange = parsed;
    else {
      activeId = periods[0]?.id ?? "";
      activeRange = periods[0] ? { start: periods[0].start, end: periods[0].end } : null;
    }
  }

  // Transactions for the period. For CREDIT cards we query by the
  // companion accountId so bill-payment transfer legs (which land on the
  // account but carry no cardId) show up alongside swipe expenses. For
  // DEBIT cards there's no companion account, so we fall back to cardId.
  const transactions = activeRange
    ? await prisma.transaction.findMany({
        where: {
          ...(isCredit && card.accountId
            ? { accountId: card.accountId }
            : { cardId: id }),
          workspaceId: card.workspaceId,
          date: rangeToPrismaFilter(activeRange),
        },
        orderBy: { date: "desc" },
        select: {
          id: true,
          type: true,
          kind: true,
          investmentAction: true,
          amount: true,
          description: true,
          date: true,
          category: { select: { name: true } },
        },
      })
    : [];

  // Period spend excludes TRANSFER legs — those are bill payments, not
  // spending. INVESTMENT BUY counts (the user actually swiped the card,
  // and the buy grew the card outstanding). INCOME (refunds) subtracts.
  const periodSpend = transactions.reduce((s, t) => {
    if (t.type === "EXPENSE") return s + Number(t.amount);
    if (t.type === "INVESTMENT" && t.investmentAction === "BUY") {
      return s + Number(t.amount);
    }
    if (t.type === "INCOME") return s - Number(t.amount);
    return s;
  }, 0);

  // ── Chart data ───────────────────────────────────────────────────────
  const trendPeriods = periods.slice(0, 6);
  const trendBuckets: CardSpendBucket[] = [];
  if (trendPeriods.length > 0) {
    const earliest = trendPeriods[trendPeriods.length - 1].start;
    const latest = trendPeriods[0].end;
    const txInRange = await prisma.transaction.findMany({
      where: {
        cardId: id,
        workspaceId: card.workspaceId,
        date: rangeToPrismaFilter({ start: earliest, end: latest }),
        OR: [
          { type: "EXPENSE" },
          { type: "INVESTMENT", investmentAction: "BUY" },
        ],
      },
      select: { amount: true, date: true },
    });
    for (const p of trendPeriods.slice().reverse()) {
      const sum = txInRange
        .filter((t) => t.date >= p.start && t.date < new Date(p.end.getTime() + 86400000))
        .reduce((s, t) => s + Number(t.amount), 0);
      trendBuckets.push({
        id: p.id,
        label: p.start.toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" }),
        rangeLabel: p.label,
        spend: sum,
        isActive: p.id === activeId,
      });
    }
  }

  const categoryMap = new Map<string, number>();
  for (const t of transactions) {
    const isExpense = t.type === "EXPENSE";
    const isInvestmentBuy =
      t.type === "INVESTMENT" && t.investmentAction === "BUY";
    if (!isExpense && !isInvestmentBuy) continue;
    const name = isInvestmentBuy
      ? "Investments"
      : (t.category?.name ?? "Uncategorized");
    categoryMap.set(name, (categoryMap.get(name) ?? 0) + Number(t.amount));
  }
  const categorySlices: CategorySlice[] = Array.from(categoryMap.entries())
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount);

  // ── CREDIT utilisation visuals ───────────────────────────────────────
  const usedAmount =
    isCredit && effectiveLimit != null && available != null
      ? effectiveLimit - available
      : 0;
  const usedPct =
    effectiveLimit && effectiveLimit > 0
      ? Math.max(0, Math.min(100, (usedAmount / effectiveLimit) * 100))
      : 0;
  const utilTone = usedPct < 50 ? "ok" : usedPct < 80 ? "warn" : "bad";
  const utilBarClass =
    utilTone === "ok"
      ? "bg-primary"
      : utilTone === "warn"
        ? "bg-amber-500"
        : "bg-destructive";
  const utilTextClass =
    utilTone === "ok"
      ? "text-primary"
      : utilTone === "warn"
        ? "text-amber-600 dark:text-amber-400"
        : "text-destructive";

  // ── DEBIT 30-day average + last-txn ──────────────────────────────────
  const lastTxnDate = transactions[0]?.date ?? null;

  // Pick the oldest unpaid statement (if any) as the auto-open fallback
  // when the user lands here from a Pay shortcut on the dashboard /
  // notifications and there's no headline outstanding to use.
  const fallbackStatement = (() => {
    for (const s of statements) {
      if (s.paidAt) continue;
      const paid = s.payments.reduce((sum, p) => sum + Number(p.amount), 0);
      const remaining = Math.max(0, Number(s.totalDue) - paid);
      if (remaining > 0) {
        return {
          outstanding: remaining,
          dueDate: s.dueDate.toISOString(),
          periodLabel: `${formatDate(s.periodStart)} — ${formatDate(s.periodEnd)}`,
        };
      }
    }
    return null;
  })();

  return (
    <div className="space-y-6">
      {isCredit && card.accountId && (
        <PayBillAutoOpener
          cardName={card.name}
          toAccountId={card.accountId}
          headline={
            amountDueNow > 0
              ? {
                  outstanding: amountDueNow,
                  dueDate: paymentDueBy?.toISOString() ?? null,
                }
              : null
          }
          fallbackStatement={fallbackStatement}
        />
      )}
      <div>
        <Link href="/cards" className="text-xs text-muted-foreground">
          ← Cards
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{card.name}</h1>
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          {card.kind} · {card.network}
          {card.supportsUpi ? " · UPI" : ""}
          {card.last4 ? ` · ••${card.last4}` : ""}
          {isSharedChild && card.parentCard && (
            <>
              {" · SHARED of "}
              <Link
                href={`/cards/${card.parentCard.id}`}
                className="underline normal-case tracking-normal"
              >
                {card.parentCard.name}
              </Link>
            </>
          )}
        </p>
      </div>

      {/* ── CREDIT hero ──────────────────────────────────────────────── */}
      {isCredit && effectiveLimit != null && (
        <section className="rounded-2xl border bg-linear-to-br from-card to-muted/40 p-4 sm:p-6">
          <div className="grid gap-6 md:grid-cols-[1.4fr_1fr]">
            <div className="flex flex-col justify-between gap-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Available limit
                </div>
                <div className={`mt-1 text-3xl sm:text-4xl font-bold tabular-nums ${utilTextClass}`}>
                  {formatINR(available ?? effectiveLimit)}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                  of {formatINR(effectiveLimit)} total
                </div>
              </div>
              <div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full ${utilBarClass} transition-all`}
                    style={{ width: `${usedPct}%` }}
                  />
                </div>
                <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground tabular-nums">
                  <span>
                    {usedPct.toFixed(0)}% used · {formatINR(usedAmount)}
                  </span>
                  <span>{formatINR(available ?? effectiveLimit)} free</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 sm:gap-4 md:grid-cols-1 md:grid-rows-3">
              <SubStat label="Credit limit" value={formatINR(effectiveLimit)} />
              <SubStat
                label="Current statement"
                value={formatINR(balance?.balance ?? 0)}
                tone={(balance?.balance ?? 0) > 0 ? "outstanding" : "muted"}
              />
              <SubStat
                label="Active EMI"
                value={formatINR(outstandingEmi)}
                tone={outstandingEmi > 0 ? "outstanding" : "muted"}
              />
            </div>
          </div>
        </section>
      )}

      {/* ── DEBIT hero ───────────────────────────────────────────────── */}
      {!isCredit && (
        <section className="rounded-2xl border bg-linear-to-br from-card to-muted/40 p-4 sm:p-6">
          <div className="grid gap-6 md:grid-cols-[1.4fr_1fr]">
            <div className="flex flex-col justify-between gap-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Spendable balance
                </div>
                <div
                  className={`mt-1 text-3xl sm:text-4xl font-bold tabular-nums ${
                    (linkedBalance?.balance ?? 0) > 0
                      ? "text-primary"
                      : (linkedBalance?.balance ?? 0) < 0
                        ? "text-destructive"
                        : ""
                  }`}
                >
                  {formatINR(linkedBalance?.balance ?? 0)}
                </div>
                {card.parentAccount ? (
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    via{" "}
                    <Link
                      href={`/accounts/${card.parentAccount.id}`}
                      className="font-medium underline"
                    >
                      {card.parentAccount.name}
                    </Link>
                  </div>
                ) : (
                  <div className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">
                    No bank account linked yet.
                  </div>
                )}
              </div>
              {(periodSpend !== 0 || transactions.length > 0) && (
                <div className="text-xs text-muted-foreground">
                  Spent <span className="font-semibold text-destructive">
                    {formatINR(Math.max(0, periodSpend))}
                  </span>{" "}
                  via this card in the selected period.
                </div>
              )}
            </div>

            <div className="grid grid-cols-3 gap-3 sm:gap-4 md:grid-cols-1 md:grid-rows-3">
              <SubStat
                label="Period spend"
                value={formatINR(Math.max(0, periodSpend))}
                tone={periodSpend > 0 ? "loss" : "muted"}
              />
              <SubStat
                label="Transactions"
                value={String(transactions.length)}
              />
              <SubStat
                label="Last used"
                value={lastTxnDate ? formatDate(lastTxnDate) : "—"}
              />
            </div>
          </div>
        </section>
      )}

      {/* ── Statement / payment-due strip (CREDIT with statement day) ── */}
      {isCredit && stmtDay && (
        <section className="rounded-lg border bg-card p-3 sm:p-4">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-4">
            <DueStat
              label="Closes on"
              value={statementClosesOn ? formatDate(statementClosesOn) : "—"}
              hint={`Day ${stmtDay} every month`}
            />
            <DueStat
              label="Payment due by"
              value={paymentDueBy ? formatDate(paymentDueBy) : "—"}
              hint={grace != null ? `${grace}-day grace` : "Set grace days"}
            />
            <DueStat
              label="Amount due"
              value={formatINR(amountDueNow)}
              tone={amountDueNow > 0 ? "loss" : "gain"}
              hint={
                billTotal != null && billPaidSoFar > 0 && amountDueNow > 0
                  ? `${formatINR(billPaidSoFar)} paid of ${formatINR(billTotal)} bill`
                  : billTotal != null && billPaidSoFar > 0 && amountDueNow === 0
                    ? `Cleared · ${formatINR(billTotal)} bill paid in full`
                    : amountDueNow > 0
                      ? billTotal != null
                        ? `Bill total ${formatINR(billTotal)}`
                        : "Last closed bill (excl. open cycle)"
                      : "Nothing owed"
              }
            />
            <DueStat
              label="Last paid"
              value={lastPayment ? formatINR(Number(lastPayment.amount)) : "—"}
              hint={
                lastPayment
                  ? `${formatDate(lastPayment.date)}${
                      lastPayment.fromAccount?.name ? ` · from ${lastPayment.fromAccount.name}` : ""
                    }`
                  : "No payments recorded"
              }
            />
          </div>
          {amountDueNow > 0 && card.accountId && (
            <div className="mt-3 flex justify-end">
              <PayBillButton
                cardName={card.name}
                toAccountId={card.accountId}
                outstanding={amountDueNow}
                dueDate={paymentDueBy?.toISOString() ?? null}
              />
            </div>
          )}
        </section>
      )}

      {/* ── Statements ledger (CREDIT only) ──────────────────────────── */}
      {isCredit && statements.length > 0 && (
        <section className="rounded-lg border bg-card">
          <header className="px-4 sm:px-5 py-3 border-b">
            <h2 className="text-sm font-semibold">Statements</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Each closed billing cycle is archived with the bill total and
              every payment made against it.
            </p>
          </header>
          <ul className="divide-y">
            {statements.map((s) => {
              const totalDue = Number(s.totalDue);
              const paidSoFar = s.payments.reduce(
                (sum, p) => sum + Number(p.amount),
                0,
              );
              const remaining = Math.max(0, totalDue - paidSoFar);
              const isPaid = s.paidAt != null;
              return (
                <li key={s.id} className="px-4 sm:px-5 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium tabular-nums">
                        {formatDate(s.periodStart)} — {formatDate(s.periodEnd)}
                      </div>
                      <div className="text-xs text-muted-foreground tabular-nums">
                        Due {formatDate(s.dueDate)}
                        {isPaid && s.paidAt
                          ? ` · cleared ${formatDate(s.paidAt)}`
                          : remaining > 0 && paidSoFar > 0
                            ? ` · ${formatINR(paidSoFar)} of ${formatINR(totalDue)} paid`
                            : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <div
                          className={`text-base font-semibold tabular-nums ${
                            isPaid
                              ? "text-emerald-700 dark:text-emerald-400"
                              : remaining > 0
                                ? "text-destructive"
                                : ""
                          }`}
                        >
                          {formatINR(totalDue)}
                        </div>
                        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                          {isPaid
                            ? "Paid"
                            : remaining > 0
                              ? `${formatINR(remaining)} due`
                              : "Settled"}
                        </div>
                      </div>
                      {!isPaid && remaining > 0 && card.accountId && (
                        <PayBillButton
                          cardName={card.name}
                          toAccountId={card.accountId}
                          outstanding={remaining}
                          dueDate={s.dueDate.toISOString()}
                          contextLabel={`${formatDate(s.periodStart)} — ${formatDate(s.periodEnd)}`}
                          variant="outline"
                          label="Pay"
                        />
                      )}
                    </div>
                  </div>
                  {s.payments.length > 0 && (
                    <ul className="mt-2 space-y-1 pl-3 border-l-2 border-border">
                      {s.payments.map((p) => (
                        <li
                          key={p.id}
                          className="flex items-baseline justify-between gap-3 text-xs"
                        >
                          <span className="text-muted-foreground">
                            {formatDate(p.date)} · from{" "}
                            {p.fromAccount?.name ??
                              p.fromContact?.name ??
                              "—"}
                            {p.notes ? ` · ${p.notes}` : ""}
                          </span>
                          <span className="tabular-nums">
                            {formatINR(Number(p.amount))}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* ── EMI loans on this card (CREDIT only) ─────────────────────── */}
      {isCredit && (activeEmiLoans.length > 0 || closedEmiLoans.length > 0) && (
        <section className="rounded-lg border bg-card">
          <header className="px-4 sm:px-5 py-3 border-b flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">EMI loans</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {activeEmiLoans.length} active ·{" "}
                <span className="text-destructive font-medium tabular-nums">
                  {formatINR(outstandingEmi)} outstanding
                </span>
                {closedEmiLoans.length > 0 && (
                  <>
                    {" · "}
                    {closedEmiLoans.length} closed ·{" "}
                    <span className="tabular-nums">{formatINR(totalEmiPaid)} cleared</span>
                  </>
                )}
              </p>
            </div>
          </header>
          <div className="divide-y">
            {activeEmiLoans.length > 0 && (
              <div className="p-4 space-y-3">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Active
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {activeEmiLoans.map((l) => {
                    const principal = Number(l.principal);
                    const outstanding = Number(l.outstanding);
                    const paid = Math.max(0, principal - outstanding);
                    const pct = principal > 0 ? (paid / principal) * 100 : 0;
                    return (
                      <div
                        key={l.id}
                        className="rounded-lg border bg-background/60 p-3 space-y-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-medium truncate">{l.lender}</div>
                            <div className="text-[11px] text-muted-foreground tabular-nums">
                              {formatINR(principal)}
                              {l.tenure ? ` · ${l.tenure} mo` : ""}
                              {l.emiAmount
                                ? ` · ${formatINR(Number(l.emiAmount))}/mo`
                                : ""}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                              Outstanding
                            </div>
                            <div className="text-sm font-semibold text-destructive tabular-nums">
                              {formatINR(outstanding)}
                            </div>
                          </div>
                        </div>
                        <div>
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full bg-primary"
                              style={{ width: `${Math.min(100, pct)}%` }}
                            />
                          </div>
                          <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground tabular-nums">
                            <span>{pct.toFixed(0)}% paid · {formatINR(paid)}</span>
                            {l.nextDueDate && (
                              <span>Next {formatDate(l.nextDueDate)}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {closedEmiLoans.length > 0 && (
              <div className="p-4 space-y-3">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Closed
                </div>
                <div className="overflow-x-auto -mx-4 px-4">
                <table className="w-full min-w-[28rem] text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b">
                      <th className="py-2 pr-3">Lender</th>
                      <th className="py-2 pr-3">Period</th>
                      <th className="py-2 pr-3 text-right">Principal</th>
                      <th className="py-2 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {closedEmiLoans.map((l) => (
                      <tr key={l.id} className="border-b last:border-0 text-muted-foreground">
                        <td className="py-2 pr-3">{l.lender}</td>
                        <td className="py-2 pr-3 text-xs whitespace-nowrap tabular-nums">
                          {formatDate(l.startedAt)}
                          {" → "}
                          {l.foreclosedAt
                            ? formatDate(l.foreclosedAt)
                            : l.maturityAt
                              ? formatDate(l.maturityAt)
                              : "—"}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {formatINR(Number(l.principal))}
                        </td>
                        <td className="py-2 text-right">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
                              l.foreclosedAt
                                ? "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400"
                                : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400"
                            }`}
                          >
                            {l.foreclosedAt ? "Foreclosed" : "Cleared"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── Charts (apply to both kinds) ─────────────────────────────── */}
      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-lg border bg-card p-4 min-w-0">
          <div>
            <h3 className="text-sm font-semibold">Spend trend</h3>
            <p className="text-xs text-muted-foreground">
              Last {trendBuckets.length} {isCredit && statementDay ? "statements" : "months"}
            </p>
          </div>
          <div className="mt-3 min-w-0">
            <CardSpendChart data={trendBuckets} />
          </div>
        </section>
        <section className="rounded-lg border bg-card p-4 min-w-0">
          <div>
            <h3 className="text-sm font-semibold">By category</h3>
            <p className="text-xs text-muted-foreground">
              Selected period · {formatINR(Math.max(0, periodSpend))}
            </p>
          </div>
          <div className="mt-3 min-w-0">
            <CategoryBreakdown data={categorySlices} />
          </div>
        </section>
      </div>

      {/* ── Transactions table ───────────────────────────────────────── */}
      <section className="rounded-lg border bg-card">
        <header className="px-4 sm:px-5 py-3 border-b flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold">
              {isCredit && statementDay ? "Statement" : "Transactions"}
            </h2>
            {activeRange && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {transactions.length} txn{transactions.length === 1 ? "" : "s"} · spend{" "}
                {formatINR(Math.max(0, periodSpend))}
              </p>
            )}
          </div>
          <PeriodFilter
            periods={periods}
            activeId={activeId}
            customFrom={sp.from}
            customTo={sp.to}
          />
        </header>
        {transactions.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">
            No transactions in this period.
          </p>
        ) : (
          <>
            {/* Mobile: stacked card-list — table cells don't fit in <400px */}
            <ul className="divide-y md:hidden">
              {transactions.map((t) => {
                const tone = txTone(t.type);
                return (
                  <li key={t.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">
                          {t.description}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <span className="tabular-nums">{formatDate(t.date)}</span>
                          {t.type === "TRANSFER" ? (
                            <>
                              <span>·</span>
                              <span className="font-medium text-emerald-700 dark:text-emerald-400">
                                Bill payment
                              </span>
                            </>
                          ) : (
                            t.category?.name && (
                              <>
                                <span>·</span>
                                <span className="truncate">{t.category.name}</span>
                              </>
                            )
                          )}
                        </div>
                      </div>
                      <div
                        className={`text-sm font-semibold tabular-nums whitespace-nowrap shrink-0 ${tone.cls}`}
                      >
                        {tone.sign}
                        {formatINR(Number(t.amount))}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            {/* Desktop: full table */}
            <table className="hidden md:table w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b bg-muted/30">
                  <th className="px-5 py-2">Date</th>
                  <th className="px-5 py-2">Description</th>
                  <th className="px-5 py-2">Category</th>
                  <th className="px-5 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((t) => {
                  const tone = txTone(t.type);
                  return (
                    <tr key={t.id} className="border-b last:border-0 hover:bg-muted/20">
                      <td className="px-5 py-2.5 text-muted-foreground whitespace-nowrap tabular-nums">
                        {formatDate(t.date)}
                      </td>
                      <td className="px-5 py-2.5">
                        <div className="font-medium truncate">{t.description}</div>
                      </td>
                      <td className="px-5 py-2.5">
                        {t.type === "TRANSFER" ? (
                          <span className="inline-flex items-center rounded-full bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                            Bill payment
                          </span>
                        ) : t.category?.name ? (
                          <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                            {t.category.name}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td
                        className={`px-5 py-2.5 text-right font-semibold tabular-nums ${tone.cls}`}
                      >
                        {tone.sign}
                        {formatINR(Number(t.amount))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </section>
    </div>
  );
}

function txTone(type: string): { sign: string; cls: string } {
  if (type === "INCOME") {
    return { sign: "+", cls: "text-emerald-700 dark:text-emerald-400" };
  }
  if (type === "TRANSFER") {
    return { sign: "+", cls: "text-emerald-700 dark:text-emerald-400" };
  }
  return { sign: "−", cls: "text-destructive" };
}

function SubStat({
  label,
  value,
  tone = "muted",
}: {
  label: string;
  value: string;
  tone?: "muted" | "outstanding" | "loss" | "gain";
}) {
  const valueClass =
    tone === "outstanding"
      ? "text-amber-700 dark:text-amber-400"
      : tone === "loss"
        ? "text-destructive"
        : tone === "gain"
          ? "text-primary"
          : "";
  return (
    <div className="rounded-lg border bg-background/60 p-2.5 sm:p-3 min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground truncate">
        {label}
      </div>
      <div
        className={`mt-1 text-base sm:text-lg font-semibold tabular-nums truncate ${valueClass}`}
      >
        {value}
      </div>
    </div>
  );
}

function DueStat({
  label,
  value,
  hint,
  tone = "muted",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "muted" | "loss" | "gain";
}) {
  const valueClass =
    tone === "loss" ? "text-destructive" : tone === "gain" ? "text-primary" : "";
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-wider sm:tracking-widest text-muted-foreground">
        {label}
      </div>
      <div
        className={`mt-1 text-sm sm:text-base font-semibold tabular-nums truncate ${valueClass}`}
      >
        {value}
      </div>
      {hint && (
        <div className="mt-0.5 text-[11px] text-muted-foreground line-clamp-2 sm:truncate">
          {hint}
        </div>
      )}
    </div>
  );
}
