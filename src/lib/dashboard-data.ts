import { prisma } from "@/lib/prisma";
import { computeAccountBalance } from "@/lib/account-balance";
import { untaggedPaymentsToCard } from "@/lib/card-statement-service";

export type Due = {
  id: string;
  source: "REMINDER" | "LOAN" | "LEASE" | "CARD_STATEMENT";
  kind: string;
  label: string;
  dueDate: string;
  amount: number | null;
  /** Original bill total — only set on entries that have been partially
   * paid, so the UI can render "X paid of Y". */
  total?: number;
  paid?: number;
  href: string;
  /** Deep link that opens the relevant Pay/Confirm dialog on the detail
   * page. UI shows a Pay button when present. */
  payHref?: string;
};

export type SettledItem = {
  id: string;
  source: "CARD_STATEMENT" | "LOAN" | "LEASE" | "REMINDER";
  kind: string;
  label: string;
  amount: number;
  paidAt: string;
  href: string;
};

export type ExpiringDocument = {
  id: string;
  kind: "RC" | "FC" | "PUC" | "ROAD_TAX" | "INSURANCE_COPY" | "OTHER";
  label: string | null;
  expiryAt: string;
  daysLeft: number;
  vehicle: { id: string; name: string; registrationNo: string | null };
};

export type DashboardStats = {
  period: { start: string; end: string; income: number; expense: number; net: number };
  netWorth: number;
  liquid: number;
  /**
   * Market Investments tile — limited to STOCK / MUTUAL_FUND / SIP. These
   * have a measurable mark-to-market and are commonly referred to as
   * "investments" in casual conversation. Other holdings (FD / RD / GOLD /
   * INSURANCE / OTHER) live on a separate tile so the headline figure
   * isn't a mixed-asset blob.
   */
  investedAmount: number;
  investedCurrent: number;
  /** FD / RD / GOLD / INSURANCE / OTHER — sum of cost basis. */
  otherHoldingsAmount: number;
  /** FD / RD / GOLD / INSURANCE / OTHER — sum of currentValue (falls back to cost). */
  otherHoldingsCurrent: number;
  cardOutstanding: number;
  loanOutstanding: number;
  chargesOutstanding: number;
};

export type DashboardCashflow = {
  dues: Due[];
  settled: SettledItem[];
  currentMonthDueGross: number;
  currentMonthDuePaid: number;
  currentMonthDueRemaining: number;
  /** Current-month dues excluding CARD_STATEMENT entries, so the Liquid
   * tile can subtract `cardOutstanding` (which already reflects every
   * card charge, billed or not) without double-counting card bills. */
  currentMonthNonCardDueRemaining: number;
  /** Insurance premiums due this month (subset of currentMonthDueRemaining).
   * Surfaced so the Upcoming Dues section can flag the insurance subtotal. */
  currentMonthInsuranceDue: number;
  /**
   * Next month's projected outflow — always populated regardless of the
   * current-month-only display filter. Breakdown lets the dashboard tile
   * show a Cards · Insurance · Loans · Leases tooltip.
   */
  nextMonthDue: number;
  nextMonthBreakdown: {
    cards: number;
    insurance: number;
    loans: number;
    leases: number;
  };
};

/**
 * Top tiles — balance-sheet snapshot. Fast: a handful of aggregates
 * plus per-account balance computations. No query depends on date
 * windows beyond the user's selected period filter for income/expense.
 */
export async function getDashboardStats(args: {
  workspaceId: string;
  periodStart: Date;
  periodEnd: Date;
  periodFilter: { gte: Date; lt: Date };
}): Promise<DashboardStats> {
  const { workspaceId, periodStart, periodEnd, periodFilter } = args;

  const [
    accounts,
    activeLoans,
    investmentsTotal,
    outstandingCharges,
    monthIncomeAgg,
    monthExpenseAgg,
  ] = await Promise.all([
    prisma.account.findMany({
      where: { workspaceId },
      select: { id: true, kind: true },
    }),
    prisma.loan.aggregate({
      where: { workspaceId, active: true },
      _sum: { outstanding: true },
    }),
    prisma.investment.groupBy({
      by: ["kind"],
      where: { workspaceId, active: true },
      _sum: { amount: true, currentValue: true },
    }),
    prisma.memberCharge.aggregate({
      where: { workspaceId, status: { in: ["OUTSTANDING", "PARTIAL"] } },
      _sum: { amount: true, settledAmount: true },
    }),
    prisma.transaction.aggregate({
      where: {
        workspaceId,
        type: "INCOME",
        date: periodFilter,
        transferId: null,
      },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: {
        workspaceId,
        type: "EXPENSE",
        date: periodFilter,
        transferId: null,
      },
      _sum: { amount: true },
    }),
  ]);

  const balances = await Promise.all(
    accounts.map((a) => computeAccountBalance(a.id)),
  );
  const accountKindById = new Map(accounts.map((a) => [a.id, a.kind]));
  let liquid = 0;
  let cardOutstanding = 0;
  for (const b of balances) {
    if (accountKindById.get(b.accountId) === "CARD") cardOutstanding += b.balance;
    else liquid += b.balance;
  }

  const loanOutstanding = Number(activeLoans._sum.outstanding ?? 0);
  // Split market-traded holdings (Market Investments tile) from the rest
  // (Other Holdings small card). Net worth includes BOTH — only the
  // dashboard presentation is split.
  const MARKET_KINDS = new Set(["STOCK", "MUTUAL_FUND", "SIP"]);
  let investedAmount = 0;
  let investedCurrent = 0;
  let otherHoldingsAmount = 0;
  let otherHoldingsCurrent = 0;
  for (const row of investmentsTotal) {
    const amt = Number(row._sum.amount ?? 0);
    const cur = Number(row._sum.currentValue ?? row._sum.amount ?? 0);
    if (MARKET_KINDS.has(row.kind)) {
      investedAmount += amt;
      investedCurrent += cur;
    } else {
      otherHoldingsAmount += amt;
      otherHoldingsCurrent += cur;
    }
  }
  const chargesOutstanding =
    Number(outstandingCharges._sum.amount ?? 0) -
    Number(outstandingCharges._sum.settledAmount ?? 0);
  const netWorth =
    liquid +
    investedCurrent +
    otherHoldingsCurrent -
    cardOutstanding -
    loanOutstanding;
  const income = Number(monthIncomeAgg._sum.amount ?? 0);
  const expense = Number(monthExpenseAgg._sum.amount ?? 0);

  return {
    period: {
      start: periodStart.toISOString(),
      end: periodEnd.toISOString(),
      income,
      expense,
      net: income - expense,
    },
    netWorth,
    liquid,
    investedAmount,
    investedCurrent,
    otherHoldingsAmount,
    otherHoldingsCurrent,
    cardOutstanding,
    loanOutstanding,
    chargesOutstanding,
  };
}

/**
 * Cashflow — upcoming dues + settled-this-month list + monthly totals.
 * Heavier: pulls payment history from every source (cards, loans,
 * leases, reminders) and assembles the chronological dues list across
 * all card paths (materialised statement / manual override / computed).
 */
export async function getDashboardCashflow(args: {
  workspaceId: string;
  today: Date;
  in30Days: Date;
  monthStart: Date;
  nextMonthBegin: Date;
  isNearMonthEnd: boolean;
}): Promise<DashboardCashflow> {
  const {
    workspaceId,
    today,
    in30Days,
    monthStart,
    nextMonthBegin,
    isNearMonthEnd,
  } = args;
  const wsId = workspaceId;

  const [
    accounts,
    upcomingReminders,
    upcomingLoanDues,
    upcomingLeaseDues,
    upcomingCardBills,
    cardStatementsTouchedThisMonth,
    untaggedCardPaymentsThisMonth,
    loanPaymentsThisMonth,
    leasePaymentsThisMonth,
    confirmedRemindersThisMonth,
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
    prisma.cardStatement.findMany({
      where: { workspaceId: wsId, paidAt: null, dueDate: { lte: in30Days } },
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
    prisma.investmentReminder.findMany({
      where: {
        workspaceId: wsId,
        status: "CONFIRMED",
        confirmedTransaction: { date: { gte: monthStart, lt: nextMonthBegin } },
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
  ]);

  // Card balance per CARD account — needed for the computed-fallback
  // path when no materialised CardStatement exists.
  const cardBalances = await Promise.all(
    accounts.filter((a) => a.kind === "CARD").map((a) => computeAccountBalance(a.id)),
  );

  // ── PAID THIS MONTH ────────────────────────────────────────────────
  let cardPaidThisMonth = 0;
  for (const s of cardStatementsTouchedThisMonth) {
    const paidThisMonth = s.payments
      .filter((p) => p.date >= monthStart && p.date < nextMonthBegin)
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

  // ── DUES (upcoming) ───────────────────────────────────────────────
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
  // Per-loan paid this month — used to mark a due as paid once
  // cumulative payments cover the EMI (handles both the loan-pay
  // endpoint AND generic LOAN_PAYMENT transactions).
  const loanPaidByLoanId = new Map<string, number>();
  for (const t of loanPaymentsThisMonth) {
    if (!t.loanId) continue;
    loanPaidByLoanId.set(
      t.loanId,
      (loanPaidByLoanId.get(t.loanId) ?? 0) + Number(t.amount),
    );
  }
  for (const l of upcomingLoanDues) {
    if (!l.nextDueDate) continue;
    const emi = l.emiAmount == null ? null : Number(l.emiAmount);
    const paidThisMonth = loanPaidByLoanId.get(l.id) ?? 0;
    const outstanding =
      emi == null ? null : Math.max(0, emi - paidThisMonth);
    dues.push({
      id: `loan:${l.id}`,
      source: "LOAN",
      kind: l.source === "CARD_EMI" ? "CARD EMI" : "LOAN EMI",
      label: l.lenderContact?.name ?? l.lender,
      dueDate: l.nextDueDate.toISOString(),
      amount: outstanding,
      ...(emi != null && paidThisMonth > 0
        ? { total: emi, paid: Math.min(emi, paidThisMonth) }
        : {}),
      href: `/loans/${l.id}`,
      payHref: `/loans/${l.id}?pay=1`,
    });
  }
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
  // have a billing cycle configured but no materialised CardStatement.
  for (const a of accounts) {
    if (a.kind !== "CARD") continue;
    if (cardAccountsWithStatement.has(a.id)) continue;
    const linkedCardId = a.linkedCard?.id ?? null;
    const cardBal = cardBalances.find((b) => b.accountId === a.id);
    const cardBalanceNow = cardBal?.balance ?? 0;
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
            ? { total: manualAmount, paid: Math.min(manualAmount, paidUntagged) }
            : {}),
          href: cardHref,
          ...(linkedCardId ? { payHref: `${cardHref}?pay=1` } : {}),
        });
      }
      continue;
    }
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
    const computedDue = new Date(lastClose.getTime() + grace * 86400000);
    if (computedDue.getTime() > in30Days.getTime()) continue;
    // Match the card-balance "owed" definition: EXPENSE + INVESTMENT BUY.
    // Without INVESTMENT here, a gold/jewel buy posted after the close
    // sits in `cardBalanceNow` but isn't subtracted out, inflating the
    // just-closed bill by the open-cycle's investment spend.
    const chargesAfterClose = await prisma.transaction.aggregate({
      where: {
        accountId: a.id,
        date: { gt: lastClose },
        OR: [
          { type: "EXPENSE", transferId: null },
          { type: "INVESTMENT", investmentAction: "BUY", transferId: null },
        ],
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
  // current calendar month.
  const visibleDues = isNearMonthEnd
    ? dues
    : dues.filter(
        (d) => new Date(d.dueDate).getTime() < nextMonthBegin.getTime(),
      );

  // ── SETTLED ───────────────────────────────────────────────────────
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
      s.paidAt && s.paidAt >= monthStart && s.paidAt < nextMonthBegin;
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
        lease?.direction === "LEASED_OUT" ? "LEASE INCOME" : "LEASE PAYMENT",
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
        r.confirmedTransaction?.date.toISOString() ?? monthStart.toISOString(),
      href: "/reminders",
    });
  }
  settled.sort((a, b) => b.paidAt.localeCompare(a.paidAt));

  // ── MONTHLY TOTALS ────────────────────────────────────────────────
  // Run the totals over the FULL `dues` list (not `visibleDues`) so the
  // "Due Next Month" tile always reports a real figure regardless of the
  // current-month display filter.
  const nextMonthStart = nextMonthBegin.getTime();
  const nextMonthEnd = new Date(
    nextMonthBegin.getFullYear(),
    nextMonthBegin.getMonth() + 1,
    1,
  ).getTime();
  let currentMonthDueRemaining = 0;
  let currentMonthNonCardDueRemaining = 0;
  let currentMonthInsuranceDue = 0;
  let nextMonthDue = 0;
  const nextMonthBreakdown = { cards: 0, insurance: 0, loans: 0, leases: 0 };
  for (const d of dues) {
    if (d.amount == null) continue;
    const t = new Date(d.dueDate).getTime();
    const isInsurance = d.source === "REMINDER" && d.kind === "INSURANCE_PREMIUM";
    if (t < nextMonthStart) {
      currentMonthDueRemaining += d.amount;
      if (d.source !== "CARD_STATEMENT") currentMonthNonCardDueRemaining += d.amount;
      if (isInsurance) currentMonthInsuranceDue += d.amount;
    } else if (t < nextMonthEnd) {
      // Cards are added to the next-month tile from the full unpaid
      // balance below — skip them here so they're not double-counted.
      if (d.source === "CARD_STATEMENT") continue;
      nextMonthDue += d.amount;
      if (isInsurance) nextMonthBreakdown.insurance += d.amount;
      else if (d.source === "LOAN" || d.kind === "LOAN_EMI")
        nextMonthBreakdown.loans += d.amount;
      else if (d.source === "LEASE") nextMonthBreakdown.leases += d.amount;
    }
  }
  // Card outstanding for the next-month tile = the live card-account
  // balance (opening + expense − income + transfersOut − transfersIn).
  // This includes the OPEN cycle's spend (e.g. a gold-on-card buy
  // posted today) and works for cards that have never had a statement
  // materialised yet. `unpaidTotalForCardAccount` only sees closed
  // cycles and would miss both cases.
  let cardsOutstanding = 0;
  for (const cb of cardBalances) {
    cardsOutstanding += Math.max(0, cb.balance);
  }
  nextMonthDue += cardsOutstanding;
  nextMonthBreakdown.cards = cardsOutstanding;
  const currentMonthDueGross = currentMonthDuePaid + currentMonthDueRemaining;

  return {
    dues: visibleDues,
    settled,
    currentMonthDueGross,
    currentMonthDuePaid,
    currentMonthDueRemaining,
    currentMonthNonCardDueRemaining,
    currentMonthInsuranceDue,
    nextMonthDue,
    nextMonthBreakdown,
  };
}

/**
 * Vehicle documents (RC / FC / PUC / Road Tax / Insurance copy / Other)
 * whose expiry falls within the next `windowDays` (or already passed).
 * Powers the "Documents expiring soon" tile on the dashboard. Cheap —
 * one indexed lookup; small result set in practice.
 */
export async function getExpiringVehicleDocuments(args: {
  workspaceId: string;
  today: Date;
  windowDays?: number;
}): Promise<ExpiringDocument[]> {
  const window = args.windowDays ?? 30;
  const horizon = new Date(args.today);
  horizon.setUTCDate(horizon.getUTCDate() + window);

  const docs = await prisma.vehicleDocument.findMany({
    where: {
      workspaceId: args.workspaceId,
      expiryAt: { lte: horizon },
    },
    orderBy: { expiryAt: "asc" },
    take: 50,
    include: {
      vehicle: { select: { id: true, name: true, registrationNo: true } },
    },
  });

  return docs.map((d) => {
    const expiry = d.expiryAt as Date;
    const days = Math.round(
      (expiry.getTime() - args.today.getTime()) / 86_400_000,
    );
    return {
      id: d.id,
      kind: d.kind,
      label: d.label,
      expiryAt: expiry.toISOString(),
      daysLeft: days,
      vehicle: {
        id: d.vehicle.id,
        name: d.vehicle.name,
        registrationNo: d.vehicle.registrationNo,
      },
    };
  });
}
