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
      cardBillsDueThisMonth,
      loansDueThisMonth,
      loanPaymentsThisMonth,
      settledCardBills,
      leaseSchedulesThisMonth,
      remindersThisMonth,
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
      // ── Current-month due/paid breakdown ────────────────────────────
      // We want three numbers that are stable across paying:
      //   Gross  = everything that fell due this month
      //   Paid   = how much you've paid against those
      //   Remain = Gross − Paid
      // The upcoming-dues array can't drive this on its own — it filters
      // out fully-paid statements/EMIs (so Gross would shrink when a bill
      // closes). These dedicated queries include the paid items too.
      // Card statements with dueDate in current calendar month — paid or
      // not. payments[] gives partial-payment totals.
      prisma.cardStatement.findMany({
        where: {
          workspaceId: wsId,
          dueDate: { gte: monthStart, lt: nextMonthBegin },
        },
        select: {
          id: true,
          totalDue: true,
          payments: { select: { amount: true } },
        },
      }),
      // Active loans whose next EMI falls in this calendar month.
      prisma.loan.findMany({
        where: {
          workspaceId: wsId,
          active: true,
          nextDueDate: { gte: monthStart, lt: nextMonthBegin },
        },
        select: { id: true, emiAmount: true },
      }),
      // Loan EMI payments posted this month — used both to aggregate
      // "loan paid this month" and to render the Settled list. The Loan
      // join carries the lender for the row label; lenderContact wins
      // for HAND_FORMAL loans where it's freshest.
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
      // Card statements settled within the current calendar month —
      // listed individually for the Settled section. Filtered to
      // statements with paidAt set; dueDate may sit in any prior month.
      prisma.cardStatement.findMany({
        where: {
          workspaceId: wsId,
          paidAt: { gte: monthStart, lt: nextMonthBegin },
        },
        orderBy: { paidAt: "desc" },
        take: 50,
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
      // Lease schedules due this month, paid or not.
      prisma.leasePaymentSchedule.findMany({
        where: {
          dueDate: { gte: monthStart, lt: nextMonthBegin },
          lease: { workspaceId: wsId },
        },
        select: { id: true, amount: true, status: true },
      }),
      // Investment reminders due this month, paid or not.
      prisma.investmentReminder.findMany({
        where: {
          workspaceId: wsId,
          dueDate: { gte: monthStart, lt: nextMonthBegin },
        },
        select: { id: true, amount: true, status: true },
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

    // ── Current-month due/paid totals ─────────────────────────────────
    // Per-source rollup so each due type is counted once. Card bills use
    // partial-payment data from CardStatementPayment; loans bring both
    // "still scheduled this month" (gross only) and "actually paid this
    // month" (gross+paid). Lease/reminder use the row's status to
    // classify as paid vs pending. Confirmed/settled rows count as both
    // gross and paid; pending rows count as gross only. The remaining
    // figure is `gross − paid` clamped at 0.
    let currentMonthDueGross = 0;
    let currentMonthDuePaid = 0;

    // 1. Card bills due this month — gross = totalDue, paid = sum(payments).
    for (const s of cardBillsDueThisMonth) {
      const total = Number(s.totalDue);
      const paid = s.payments.reduce(
        (acc, p) => acc + Number(p.amount),
        0,
      );
      currentMonthDueGross += total;
      currentMonthDuePaid += Math.min(total, paid);
    }
    // 2. Loans with a scheduled EMI this month and still active —
    // contributes the EMI amount to gross (paid later via loan payments).
    for (const l of loansDueThisMonth) {
      if (l.emiAmount) currentMonthDueGross += Number(l.emiAmount);
    }
    // 3. Loan EMI payments posted this month — adds to BOTH gross and
    // paid. If a loan still has its nextDueDate in this month AND was
    // partially paid this month we'd be slightly double-counting it on
    // the gross side, but that's a rare overlap and resolves itself once
    // the next refresh's nextDueDate advances.
    const loanPaidThisMonth = loanPaymentsThisMonth.reduce(
      (acc, t) => acc + Number(t.amount),
      0,
    );
    currentMonthDueGross += loanPaidThisMonth;
    currentMonthDuePaid += loanPaidThisMonth;

    // 4. Leases due this month — UPCOMING is gross only, CONFIRMED is
    // both. CANCELLED/SKIPPED rows are dropped.
    for (const s of leaseSchedulesThisMonth) {
      const amt = Number(s.amount);
      if (s.status === "UPCOMING") {
        currentMonthDueGross += amt;
      } else if (s.status === "CONFIRMED") {
        currentMonthDueGross += amt;
        currentMonthDuePaid += amt;
      }
    }
    // 5. Investment reminders due this month — same UPCOMING/CONFIRMED
    // split as leases; reminders without an amount are informational and
    // skipped.
    for (const r of remindersThisMonth) {
      if (r.amount == null) continue;
      const amt = Number(r.amount);
      if (r.status === "UPCOMING") {
        currentMonthDueGross += amt;
      } else if (r.status === "CONFIRMED") {
        currentMonthDueGross += amt;
        currentMonthDuePaid += amt;
      }
    }

    const currentMonthDueRemaining = Math.max(
      0,
      currentMonthDueGross - currentMonthDuePaid,
    );

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

    // ── Settled this month ─────────────────────────────────────────────
    // Forward-looking dues hide everything that's already paid; this list
    // surfaces those so the user can confirm bills/EMIs they cleared.
    // Card statements use paidAt; loan EMI payments use the txn date;
    // lease/reminder use the schedule's own dueDate (no separate
    // settled-at field on those rows).
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
    for (const s of settledCardBills) {
      const total = Number(s.totalDue);
      const paid = s.payments.reduce((a, p) => a + Number(p.amount), 0);
      const cardId = s.account.linkedCard?.id ?? null;
      settled.push({
        id: `card-statement:${s.id}`,
        source: "CARD_STATEMENT",
        kind: "CARD BILL",
        label: s.account.name,
        amount: Math.min(total, paid),
        paidAt: (s.paidAt ?? s.dueDate).toISOString(),
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
    for (const s of leaseSchedulesThisMonth) {
      if (s.status !== "CONFIRMED") continue;
      settled.push({
        id: `lease-schedule:${s.id}`,
        source: "LEASE",
        kind: "LEASE PAYMENT",
        label: "Lease",
        amount: Number(s.amount),
        // No paidAt on lease schedules — using dueDate as the closest
        // available timestamp for sort ordering.
        paidAt: monthStart.toISOString(),
        href: "/leases",
      });
    }
    for (const r of remindersThisMonth) {
      if (r.status !== "CONFIRMED" || r.amount == null) continue;
      settled.push({
        id: `reminder:${r.id}`,
        source: "REMINDER",
        kind: "REMINDER",
        label: "Reminder",
        amount: Number(r.amount),
        paidAt: monthStart.toISOString(),
        href: "/reminders",
      });
    }
    settled.sort((a, b) => b.paidAt.localeCompare(a.paidAt));

    // Next-month preview — sum of upcoming amounts whose dueDate sits
    // in the next calendar month (within the 30-day lookahead). Uses the
    // dues array (forward-looking only) since "next month" hasn't had
    // any payments yet by definition.
    const nextMonthStart = nextMonthBegin.getTime();
    let nextMonthDue = 0;
    for (const d of dues) {
      if (d.amount == null) continue;
      const t = new Date(d.dueDate).getTime();
      if (t >= nextMonthStart) nextMonthDue += d.amount;
    }

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
      dues,
      settled,
    });
  } catch (e) {
    return err(e);
  }
}
