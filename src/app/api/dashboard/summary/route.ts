import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { computeAccountBalance } from "@/lib/account-balance";
import { untaggedPaymentsToCard } from "@/lib/card-statement-service";
import { parsePeriodId, rangeToPrismaFilter } from "@/lib/statement-period";
import { TIMING } from "@/lib/timing";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[dashboard]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const ctx = await requireWorkspace("dashboard", "read");
    const wsId = ctx.workspaceId;
    const url = new URL(request.url);
    const periodParam = url.searchParams.get("period");
    const fromParam = url.searchParams.get("from");
    const toParam = url.searchParams.get("to");

    // Default = current calendar month.
    const now = new Date();
    let periodStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    let periodEnd = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
    );

    if (periodParam === "custom" && fromParam && toParam) {
      const s = new Date(`${fromParam}T00:00:00Z`);
      const e = new Date(`${toParam}T00:00:00Z`);
      if (!isNaN(s.getTime()) && !isNaN(e.getTime())) {
        periodStart = s;
        periodEnd = e;
      }
    } else if (periodParam) {
      const parsed = parsePeriodId(periodParam);
      if (parsed) {
        periodStart = parsed.start;
        periodEnd = parsed.end;
      }
    }
    const periodFilter = rangeToPrismaFilter({ start: periodStart, end: periodEnd });

    // Window for "upcoming dues" — TIMING.dashboardUpcomingDuesDays
    // starting from today (not from the period filter, since dues are
    // forward-looking regardless of which month the user is reviewing).
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const in30Days = new Date(today);
    in30Days.setUTCDate(in30Days.getUTCDate() + TIMING.dashboardUpcomingDuesDays);

    // Strict current-calendar-month boundaries for the "card bills paid
    // this month" stat — independent of the period filter so the number
    // doesn't shift when the user looks at a different month.
    const monthStart = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1),
    );
    const nextMonthBegin = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1),
    );
    // Only surface next-month dues when we're in the last 7 days of the
    // current month — otherwise a bill due 25+ days out clutters the
    // dashboard with stuff the user can't act on yet.
    const daysInThisMonth = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0),
    ).getUTCDate();
    const isNearMonthEnd = today.getUTCDate() > daysInThisMonth - 7;

    const [
      accounts,
      upcomingReminders,
      upcomingLoanDues,
      upcomingLeaseDues,
      upcomingCardBills,
      outstandingCharges,
      activeLoans,
      investmentsTotal,
      monthIncomeAgg,
      monthExpenseAgg,
      // ── This-month cashflow data ─────────────────────────────────────
      // Three independent question types per source:
      //   • What was paid this month? (transactions/payments with date
      //     in [monthStart, nextMonthBegin))
      //   • What is still outstanding for this month? (obligations whose
      //     due date is in this month or earlier and not yet settled)
      //   • Which items go in the Settled list? (paid-this-month rows)
      //
      // Card statements that had any activity this month — either
      // closed via paidAt, or had a transfer dated in the month.
      cardStatementsTouchedThisMonth,
      // Card statements still owed for this month or earlier.
      outstandingCardBillsThisMonth,
      // Untagged transfers to CARD accounts dated this month — covers
      // the manual-billing and computed-fallback card paths where no
      // CardStatement row exists.
      untaggedCardPaymentsThisMonth,
      // Loan EMI payments dated this month.
      loanPaymentsThisMonth,
      // Active loans whose next EMI is in this month or already overdue.
      outstandingLoansThisMonth,
      // Lease confirmation transactions dated this month.
      leasePaymentsThisMonth,
      // Lease schedules still pending for this month or earlier.
      outstandingLeasesThisMonth,
      // Investment reminders confirmed this month.
      confirmedRemindersThisMonth,
      // Investment reminders still pending for this month or earlier.
      outstandingRemindersThisMonth,
    ] = await Promise.all([
      prisma.account.findMany({
        where: { workspaceId: wsId },
        select: {
          id: true,
          kind: true,
          name: true,
          statementDate: true,
          gracePeriod: true,
          nextBillDue: true,
          nextBillAmount: true,
          linkedCard: { select: { id: true } },
        },
      }),
      prisma.investmentReminder.findMany({
        where: { workspaceId: wsId, status: "UPCOMING", dueDate: { lte: in30Days } },
        orderBy: { dueDate: "asc" },
        take: 20,
        include: {
          investment: { select: { name: true, kind: true } },
          loan: {
            select: {
              lender: true,
              kind: true,
              lenderContact: { select: { name: true } },
            },
          },
        },
      }),
      prisma.loan.findMany({
        where: {
          workspaceId: wsId,
          active: true,
          nextDueDate: { gte: today, lte: in30Days },
        },
        orderBy: { nextDueDate: "asc" },
        take: 20,
        select: {
          id: true,
          lender: true,
          kind: true,
          source: true,
          emiAmount: true,
          nextDueDate: true,
          lenderContact: { select: { name: true } },
        },
      }),
      prisma.leasePaymentSchedule.findMany({
        where: {
          status: "UPCOMING",
          dueDate: { gte: today, lte: in30Days },
          lease: { workspaceId: wsId },
        },
        orderBy: { dueDate: "asc" },
        take: 20,
        include: {
          lease: {
            select: {
              id: true,
              direction: true,
              lessorName: true,
              lesseeName: true,
              lessorContact: { select: { name: true } },
              lesseeContact: { select: { name: true } },
            },
          },
        },
      }),
      // Credit-card bills: every closed-but-unpaid statement (overdue or
      // upcoming within 30 days). Excludes the still-open cycle's spend by
      // construction — only materialised statements are returned.
      prisma.cardStatement.findMany({
        where: {
          workspaceId: wsId,
          paidAt: null,
          dueDate: { lte: in30Days },
        },
        orderBy: { dueDate: "asc" },
        take: 20,
        include: {
          account: {
            select: {
              id: true,
              name: true,
              linkedCard: { select: { id: true } },
            },
          },
          payments: { select: { amount: true } },
        },
      }),
      prisma.memberCharge.aggregate({
        where: { workspaceId: wsId, status: { in: ["OUTSTANDING", "PARTIAL"] } },
        _sum: { amount: true, settledAmount: true },
      }),
      prisma.loan.aggregate({
        where: { workspaceId: wsId, active: true },
        _sum: { outstanding: true },
      }),
      prisma.investment.aggregate({
        where: { workspaceId: wsId, active: true },
        _sum: { amount: true, currentValue: true },
      }),
      prisma.transaction.aggregate({
        where: {
          workspaceId: wsId,
          type: "INCOME",
          date: periodFilter,
          transferId: null,
        },
        _sum: { amount: true },
      }),
      prisma.transaction.aggregate({
        where: {
          workspaceId: wsId,
          type: "EXPENSE",
          date: periodFilter,
          transferId: null,
        },
        _sum: { amount: true },
      }),
      // Card statements with any activity this month: either closed
      // (paidAt set) or had a transfer dated in the month. Catches
      // overdue bills paid this month and partial payments alike.
      prisma.cardStatement.findMany({
        where: {
          workspaceId: wsId,
          OR: [
            { paidAt: { gte: monthStart, lt: nextMonthBegin } },
            { payments: { some: { date: { gte: monthStart, lt: nextMonthBegin } } } },
          ],
        },
        orderBy: { dueDate: "desc" },
        take: 50,
        include: {
          account: {
            select: {
              id: true,
              name: true,
              linkedCard: { select: { id: true } },
            },
          },
          payments: { select: { amount: true, date: true } },
        },
      }),
      // Card statements still owed for this calendar month or earlier
      // (overdue). Drives the "remaining" total — feeds Math.max(0, …)
      // per statement using sum-of-payments to handle partial-paid rows.
      prisma.cardStatement.findMany({
        where: {
          workspaceId: wsId,
          paidAt: null,
          dueDate: { lt: nextMonthBegin },
        },
        select: {
          id: true,
          accountId: true,
          totalDue: true,
          payments: { select: { amount: true } },
        },
      }),
      // Untagged transfers to CARD accounts dated this month — covers
      // the manual-billing and computed-fallback card paths where no
      // CardStatement row exists. Tagged payments (statementId set) are
      // already handled via cardStatementsTouchedThisMonth.
      prisma.transfer.findMany({
        where: {
          workspaceId: wsId,
          statementId: null,
          toAccount: { kind: "CARD" },
          date: { gte: monthStart, lt: nextMonthBegin },
        },
        orderBy: { date: "desc" },
        take: 50,
        select: {
          id: true,
          amount: true,
          date: true,
          toAccount: {
            select: {
              id: true,
              name: true,
              linkedCard: { select: { id: true } },
            },
          },
        },
      }),
      // Loan EMI payments posted this month — both aggregated into
      // "paid" and rendered individually in the Settled list.
      prisma.transaction.findMany({
        where: {
          workspaceId: wsId,
          type: "EXPENSE",
          kind: "LOAN_PAYMENT",
          date: { gte: monthStart, lt: nextMonthBegin },
          transferId: null,
        },
        orderBy: { date: "desc" },
        take: 50,
        select: {
          id: true,
          amount: true,
          date: true,
          loanId: true,
          loan: {
            select: {
              id: true,
              lender: true,
              source: true,
              lenderContact: { select: { name: true } },
            },
          },
        },
      }),
      // Active loans with nextDueDate in this month or already overdue.
      // Subtracts any loan-payment-this-month per loan so partial
      // payments collapse cleanly — see calc below.
      prisma.loan.findMany({
        where: {
          workspaceId: wsId,
          active: true,
          nextDueDate: { not: null, lt: nextMonthBegin },
        },
        select: { id: true, emiAmount: true },
      }),
      // Lease confirmations posted this month — Transactions linked
      // back to a LeasePaymentSchedule. Used for both the "paid" total
      // and the Settled list.
      prisma.transaction.findMany({
        where: {
          workspaceId: wsId,
          leaseScheduleId: { not: null },
          date: { gte: monthStart, lt: nextMonthBegin },
        },
        orderBy: { date: "desc" },
        take: 50,
        select: {
          id: true,
          amount: true,
          date: true,
          leaseSchedule: {
            select: {
              id: true,
              lease: {
                select: {
                  id: true,
                  direction: true,
                  lessorName: true,
                  lesseeName: true,
                  lessorContact: { select: { name: true } },
                  lesseeContact: { select: { name: true } },
                },
              },
            },
          },
        },
      }),
      // Lease schedules still pending for this month or earlier.
      prisma.leasePaymentSchedule.findMany({
        where: {
          status: "UPCOMING",
          dueDate: { lt: nextMonthBegin },
          lease: { workspaceId: wsId },
        },
        select: { id: true, amount: true },
      }),
      // Investment reminders confirmed this month (linked txn dated in
      // month). Powers the Settled list and the "paid" total.
      prisma.investmentReminder.findMany({
        where: {
          workspaceId: wsId,
          status: "CONFIRMED",
          confirmedTransaction: {
            date: { gte: monthStart, lt: nextMonthBegin },
          },
        },
        orderBy: { dueDate: "desc" },
        take: 50,
        select: {
          id: true,
          amount: true,
          investment: { select: { name: true } },
          loan: {
            select: { lender: true, lenderContact: { select: { name: true } } },
          },
          confirmedTransaction: { select: { date: true } },
        },
      }),
      // Investment reminders still pending for this month or earlier.
      prisma.investmentReminder.findMany({
        where: {
          workspaceId: wsId,
          status: "UPCOMING",
          dueDate: { lt: nextMonthBegin },
        },
        select: { id: true, amount: true },
      }),
    ]);

    const bankCashBalances = await Promise.all(
      accounts.filter((a) => a.kind !== "CARD").map((a) => computeAccountBalance(a.id)),
    );
    const cardBalances = await Promise.all(
      accounts.filter((a) => a.kind === "CARD").map((a) => computeAccountBalance(a.id)),
    );

    const liquid = bankCashBalances.reduce((s, b) => s + b.balance, 0);
    const cardOutstanding = cardBalances.reduce((s, b) => s + b.balance, 0);
    const loanOutstanding = Number(activeLoans._sum.outstanding ?? 0);
    const investedAmount = Number(investmentsTotal._sum.amount ?? 0);
    const investedCurrent = Number(investmentsTotal._sum.currentValue ?? investedAmount);
    const netWorth = liquid + investedCurrent - cardOutstanding - loanOutstanding;
    const chargesOutstanding =
      Number(outstandingCharges._sum.amount ?? 0) -
      Number(outstandingCharges._sum.settledAmount ?? 0);

    // ── This-month cashflow ─────────────────────────────────────────
    // Three figures from independent data:
    //   Paid      = sum of every payment dated this month (across cards,
    //               loans, leases, confirmed reminders).
    //   Remaining = sum of every obligation still owed for this month or
    //               earlier (overdue + due-this-month, not yet paid).
    //   Gross     = Paid + Remaining — the total cashflow burden the
    //               month is asking for.
    //
    // Built from real transactions, so paying a bill increases Paid and
    // decreases Remaining by the same amount; Gross stays constant.
    // Catches the previously-missed cases of overdue bills paid this
    // month and partial payments to past-due statements.

    // PAID THIS MONTH — sum of every payment transaction dated in the
    // current calendar month, across all sources. Real cashflow basis.
    //   • Card statement payments (tagged via Transfer.statementId)
    //   • Untagged transfers to CARD accounts (manual + computed paths)
    //   • Loan EMI payments (LOAN_PAYMENT EXPENSE)
    //   • Lease confirmations (Transaction.leaseScheduleId set)
    //   • Reminder confirmations (InvestmentReminder.confirmedTransaction)
    let cardPaidThisMonth = 0;
    for (const s of cardStatementsTouchedThisMonth) {
      const paidThisMonth = s.payments
        .filter(
          (p) => p.date >= monthStart && p.date < nextMonthBegin,
        )
        .reduce((acc, p) => acc + Number(p.amount), 0);
      cardPaidThisMonth += paidThisMonth;
    }
    for (const t of untaggedCardPaymentsThisMonth) {
      cardPaidThisMonth += Number(t.amount);
    }
    const loanPaidThisMonth = loanPaymentsThisMonth.reduce(
      (acc, t) => acc + Number(t.amount),
      0,
    );
    const leasePaidThisMonth = leasePaymentsThisMonth.reduce(
      (acc, t) => acc + Number(t.amount),
      0,
    );
    let reminderPaidThisMonth = 0;
    for (const r of confirmedRemindersThisMonth) {
      if (r.amount != null) reminderPaidThisMonth += Number(r.amount);
    }
    const currentMonthDuePaid =
      cardPaidThisMonth +
      loanPaidThisMonth +
      leasePaidThisMonth +
      reminderPaidThisMonth;
    // currentMonthDueRemaining and currentMonthDueGross are derived from
    // the dues array further below — the dues array already correctly
    // handles all three card paths (materialised CardStatement, manual
    // override on Account, and computed fallback from statementDate).

    // ── Merge upcoming-dues into one chronological list ────────────────
    type Due = {
      id: string;
      source: "REMINDER" | "LOAN" | "LEASE" | "CARD_STATEMENT";
      kind: string;
      label: string;
      dueDate: string;
      amount: number | null;
      /** Original bill total — only set on CARD_STATEMENT entries that
       * have been partially paid, so the UI can render "X paid of Y". */
      total?: number;
      paid?: number;
      href: string;
      /** Deep link that opens the relevant Pay/Confirm dialog on the
       * detail page. Absent only when the due type has no payment flow
       * we can deep-link into. UI shows a "Pay" button when present. */
      payHref?: string;
    };
    const dues: Due[] = [];
    for (const r of upcomingReminders) {
      const label =
        r.investment?.name ??
        r.loan?.lenderContact?.name ??
        r.loan?.lender ??
        r.kind.replace(/_/g, " ");
      dues.push({
        id: `reminder:${r.id}`,
        source: "REMINDER",
        kind: r.kind,
        label,
        dueDate: r.dueDate.toISOString(),
        amount: r.amount == null ? null : Number(r.amount),
        href: "/reminders",
        payHref: `/reminders?confirm=${r.id}`,
      });
    }
    for (const l of upcomingLoanDues) {
      if (!l.nextDueDate) continue;
      dues.push({
        id: `loan:${l.id}`,
        source: "LOAN",
        kind: l.source === "CARD_EMI" ? "CARD EMI" : "LOAN EMI",
        label: l.lenderContact?.name ?? l.lender,
        dueDate: l.nextDueDate.toISOString(),
        amount: l.emiAmount == null ? null : Number(l.emiAmount),
        href: `/loans/${l.id}`,
        payHref: `/loans/${l.id}?pay=1`,
      });
    }
    // Track which card-account-ids already produced a CardStatement-based
    // due so the manual/fallback path doesn't double-count them. Only mark
    // the account when we actually push a due — a materialised-but-cleared
    // statement (outstanding=0 with stale paidAt) shouldn't suppress a
    // separate manual override for a future bill.
    const cardAccountsWithStatement = new Set<string>();
    for (const s of upcomingCardBills) {
      const paid = s.payments.reduce((acc, p) => acc + Number(p.amount), 0);
      const total = Number(s.totalDue);
      const outstanding = Math.max(0, total - paid);
      if (outstanding === 0) continue;
      cardAccountsWithStatement.add(s.account.id);
      const cardId = s.account.linkedCard?.id ?? null;
      const cardHref = cardId ? `/cards/${cardId}` : "/cards";
      dues.push({
        id: `card-statement:${s.id}`,
        source: "CARD_STATEMENT",
        kind: "CARD BILL",
        label: s.account.name,
        dueDate: s.dueDate.toISOString(),
        amount: outstanding,
        ...(paid > 0 ? { total, paid: Math.min(total, paid) } : {}),
        href: cardHref,
        ...(cardId ? { payHref: `${cardHref}?pay=1` } : {}),
      });
    }
    // Manual-override + computed fallback for credit-card accounts that
    // have a billing cycle configured but no materialised CardStatement
    // yet (e.g. card just added with openingBalance, no transactions).
    for (let i = 0; i < accounts.length; i++) {
      const a = accounts[i];
      if (a.kind !== "CARD") continue;
      if (cardAccountsWithStatement.has(a.id)) continue;
      const linkedCardId = a.linkedCard?.id ?? null;
      const cardBal = cardBalances.find((b) => b.accountId === a.id);
      const cardBalanceNow = cardBal?.balance ?? 0;
      // 1. Manual override wins. Subtract any untagged payments to this
      //    card account dated on/before the manual due date — without a
      //    materialised statement, transfers can't be tagged, so this is
      //    the only signal that partial payments have been made.
      const manualDue = a.nextBillDue;
      const manualAmount =
        a.nextBillAmount != null ? Number(a.nextBillAmount) : null;
      if (
        manualDue &&
        manualAmount != null &&
        manualAmount > 0 &&
        manualDue.getTime() <= in30Days.getTime()
      ) {
        const paidUntagged = await untaggedPaymentsToCard(a.id, manualDue);
        const outstanding = Math.max(0, manualAmount - paidUntagged);
        if (outstanding > 0) {
          const cardHref = linkedCardId ? `/cards/${linkedCardId}` : "/cards";
          dues.push({
            id: `card-manual:${a.id}`,
            source: "CARD_STATEMENT",
            kind: "CARD BILL",
            label: a.name,
            dueDate: manualDue.toISOString(),
            amount: outstanding,
            ...(paidUntagged > 0
              ? {
                  total: manualAmount,
                  paid: Math.min(manualAmount, paidUntagged),
                }
              : {}),
            href: cardHref,
            ...(linkedCardId ? { payHref: `${cardHref}?pay=1` } : {}),
          });
        }
        continue;
      }
      // 2. Compute from current balance + statementDate when no manual
      //    override and no CardStatement exists yet.
      if (a.statementDate == null || cardBalanceNow <= 0) continue;
      const sd = a.statementDate;
      const grace = a.gracePeriod ?? 0;
      const ty = today.getUTCFullYear();
      const tm = today.getUTCMonth();
      const td = today.getUTCDate();
      let closeY = ty;
      let closeM = tm;
      if (td < sd) {
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
        Date.UTC(closeY, closeM, Math.min(sd, monthLastDay)),
      );
      const computedDue = new Date(
        lastClose.getTime() + grace * 86400000,
      );
      if (computedDue.getTime() > in30Days.getTime()) continue;
      const chargesAfterClose = await prisma.transaction.aggregate({
        where: {
          accountId: a.id,
          type: "EXPENSE",
          date: { gt: lastClose },
          transferId: null,
        },
        _sum: { amount: true },
      });
      const computedAmount = Math.max(
        0,
        cardBalanceNow - Number(chargesAfterClose._sum.amount ?? 0),
      );
      if (computedAmount <= 0) continue;
      const cardHref = linkedCardId ? `/cards/${linkedCardId}` : "/cards";
      dues.push({
        id: `card-computed:${a.id}`,
        source: "CARD_STATEMENT",
        kind: "CARD BILL",
        label: a.name,
        dueDate: computedDue.toISOString(),
        amount: computedAmount,
        href: cardHref,
        ...(linkedCardId ? { payHref: `${cardHref}?pay=1` } : {}),
      });
    }
    for (const s of upcomingLeaseDues) {
      const counterparty =
        s.lease.direction === "LEASED_OUT"
          ? (s.lease.lesseeContact?.name ?? s.lease.lesseeName)
          : (s.lease.lessorContact?.name ?? s.lease.lessorName);
      dues.push({
        id: `lease:${s.id}`,
        source: "LEASE",
        kind: s.lease.direction === "LEASED_OUT" ? "LEASE INCOME" : "LEASE PAYMENT",
        label: counterparty ?? "Lease",
        dueDate: s.dueDate.toISOString(),
        amount: Number(s.amount),
        href: `/leases/${s.lease.id}`,
        payHref: `/leases/${s.lease.id}?confirm=${s.id}`,
      });
    }
    dues.sort((a, b) => a.dueDate.localeCompare(b.dueDate));

    // Suppress next-month items unless we're in the last week of the
    // current calendar month. Without this, a bill due in the first week
    // of next month shows up on the 1st of this month — too far out to
    // be actionable and clutters the upcoming-dues list.
    const visibleDues = isNearMonthEnd
      ? dues
      : dues.filter(
          (d) => new Date(d.dueDate).getTime() < nextMonthBegin.getTime(),
        );

    // ── Settled this month ─────────────────────────────────────────────
    // What got paid this month, listed individually. Each source uses
    // the most-meaningful timestamp:
    //   • Card statements → most-recent payment date in the month, or
    //     paidAt when the bill closed in the month.
    //   • Loan/lease/reminder → the linked transaction's date.
    type SettledItem = {
      id: string;
      source: "CARD_STATEMENT" | "LOAN" | "LEASE" | "REMINDER";
      kind: string;
      label: string;
      amount: number;
      paidAt: string;
      href: string;
    };
    const settled: SettledItem[] = [];
    for (const s of cardStatementsTouchedThisMonth) {
      const paymentsThisMonth = s.payments.filter(
        (p) => p.date >= monthStart && p.date < nextMonthBegin,
      );
      const paidAmount = paymentsThisMonth.reduce(
        (a, p) => a + Number(p.amount),
        0,
      );
      if (paidAmount === 0) continue;
      const latestPaymentDate = paymentsThisMonth.reduce(
        (latest: Date, p) => (p.date > latest ? p.date : latest),
        paymentsThisMonth[0]?.date ?? monthStart,
      );
      const cardId = s.account.linkedCard?.id ?? null;
      const isFullyClosed =
        s.paidAt &&
        s.paidAt >= monthStart &&
        s.paidAt < nextMonthBegin;
      settled.push({
        id: `card-statement:${s.id}`,
        source: "CARD_STATEMENT",
        kind: isFullyClosed ? "CARD BILL" : "CARD BILL · partial",
        label: s.account.name,
        amount: paidAmount,
        paidAt: latestPaymentDate.toISOString(),
        href: cardId ? `/cards/${cardId}` : "/cards",
      });
    }
    for (const t of untaggedCardPaymentsThisMonth) {
      const cardId = t.toAccount?.linkedCard?.id ?? null;
      settled.push({
        id: `card-untagged:${t.id}`,
        source: "CARD_STATEMENT",
        kind: "CARD PAYMENT",
        label: t.toAccount?.name ?? "Card",
        amount: Number(t.amount),
        paidAt: t.date.toISOString(),
        href: cardId ? `/cards/${cardId}` : "/cards",
      });
    }
    for (const t of loanPaymentsThisMonth) {
      const label =
        t.loan?.lenderContact?.name ?? t.loan?.lender ?? "Loan payment";
      settled.push({
        id: `loan-payment:${t.id}`,
        source: "LOAN",
        kind: t.loan?.source === "CARD_EMI" ? "CARD EMI" : "LOAN EMI",
        label,
        amount: Number(t.amount),
        paidAt: t.date.toISOString(),
        href: t.loanId ? `/loans/${t.loanId}` : "/loans/bank",
      });
    }
    for (const t of leasePaymentsThisMonth) {
      const lease = t.leaseSchedule?.lease;
      const counterparty =
        lease?.direction === "LEASED_OUT"
          ? (lease.lesseeContact?.name ?? lease.lesseeName)
          : (lease?.lessorContact?.name ?? lease?.lessorName);
      settled.push({
        id: `lease-payment:${t.id}`,
        source: "LEASE",
        kind:
          lease?.direction === "LEASED_OUT"
            ? "LEASE INCOME"
            : "LEASE PAYMENT",
        label: counterparty ?? "Lease",
        amount: Number(t.amount),
        paidAt: t.date.toISOString(),
        href: lease ? `/leases/${lease.id}` : "/leases",
      });
    }
    for (const r of confirmedRemindersThisMonth) {
      if (r.amount == null) continue;
      const label =
        r.investment?.name ??
        r.loan?.lenderContact?.name ??
        r.loan?.lender ??
        "Reminder";
      settled.push({
        id: `reminder:${r.id}`,
        source: "REMINDER",
        kind: "REMINDER",
        label,
        amount: Number(r.amount),
        paidAt:
          r.confirmedTransaction?.date.toISOString() ??
          monthStart.toISOString(),
        href: "/reminders",
      });
    }
    settled.sort((a, b) => b.paidAt.localeCompare(a.paidAt));

    // Single pass through the dues array splits remaining cashflow:
    //   • dueDate in current calendar month or earlier → remaining
    //     (this matches the items the user can still pay this month and
    //     is the source of truth for the "Due remaining" card)
    //   • dueDate in the next calendar month → next-month preview
    // Each entry's `amount` is its current outstanding (already net of
    // any partial payments), so this captures all card paths uniformly.
    const nextMonthStart = nextMonthBegin.getTime();
    let currentMonthDueRemaining = 0;
    let nextMonthDue = 0;
    for (const d of visibleDues) {
      if (d.amount == null) continue;
      const t = new Date(d.dueDate).getTime();
      if (t < nextMonthStart) currentMonthDueRemaining += d.amount;
      else nextMonthDue += d.amount;
    }
    const currentMonthDueGross = currentMonthDuePaid + currentMonthDueRemaining;

    return NextResponse.json({
      period: {
        start: periodStart.toISOString(),
        end: periodEnd.toISOString(),
        income: Number(monthIncomeAgg._sum.amount ?? 0),
        expense: Number(monthExpenseAgg._sum.amount ?? 0),
        net:
          Number(monthIncomeAgg._sum.amount ?? 0) -
          Number(monthExpenseAgg._sum.amount ?? 0),
      },
      netWorth,
      liquid,
      investedAmount,
      investedCurrent,
      cardOutstanding,
      loanOutstanding,
      chargesOutstanding,
      // Three independent figures for "this calendar month":
      //   gross  — everything that fell due (stable as you pay)
      //   paid   — total paid against those dues
      //   remain — gross − paid (cashflow still required)
      currentMonthDueGross,
      currentMonthDuePaid,
      currentMonthDueRemaining,
      nextMonthDue,
      dues: visibleDues,
      settled,
    });
  } catch (e) {
    return err(e);
  }
}
