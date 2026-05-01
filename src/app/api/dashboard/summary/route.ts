import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { computeAccountBalance } from "@/lib/account-balance";
import { untaggedPaymentsToCard } from "@/lib/card-statement-service";
import { parsePeriodId, rangeToPrismaFilter } from "@/lib/statement-period";

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

    // Window for "upcoming dues" — 30 days starting from today (not from
    // the period filter, since dues are forward-looking regardless of
    // which month the user is reviewing).
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const in30Days = new Date(today);
    in30Days.setUTCDate(in30Days.getUTCDate() + 30);

    const [
      accounts,
      activeCropBatches,
      activeLivestockBatches,
      upcomingReminders,
      upcomingLoanDues,
      upcomingLeaseDues,
      upcomingCardBills,
      pendingSettlements,
      outstandingCharges,
      activeLoans,
      investmentsTotal,
      monthIncomeAgg,
      monthExpenseAgg,
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
      prisma.cropBatch.count({
        where: { active: true, crop: { workspaceId: wsId } },
      }),
      prisma.livestockBatch.count({
        where: { active: true, livestock: { workspaceId: wsId } },
      }),
      prisma.investmentReminder.findMany({
        where: { workspaceId: wsId, status: "UPCOMING", dueDate: { lte: in30Days } },
        orderBy: { dueDate: "asc" },
        take: 20,
        include: {
          investment: { select: { name: true, kind: true } },
          loan: { select: { lender: true, kind: true } },
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
      prisma.wageSettlement.count({
        where: { worker: { workspaceId: wsId }, status: "PENDING" },
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
    };
    const dues: Due[] = [];
    for (const r of upcomingReminders) {
      const label =
        r.investment?.name ?? r.loan?.lender ?? r.kind.replace(/_/g, " ");
      dues.push({
        id: `reminder:${r.id}`,
        source: "REMINDER",
        kind: r.kind,
        label,
        dueDate: r.dueDate.toISOString(),
        amount: r.amount == null ? null : Number(r.amount),
        href: "/reminders",
      });
    }
    for (const l of upcomingLoanDues) {
      if (!l.nextDueDate) continue;
      dues.push({
        id: `loan:${l.id}`,
        source: "LOAN",
        kind: l.source === "CARD_EMI" ? "CARD EMI" : "LOAN EMI",
        label: l.lender,
        dueDate: l.nextDueDate.toISOString(),
        amount: l.emiAmount == null ? null : Number(l.emiAmount),
        href: l.source === "CARD_EMI" ? "/cards" : "/loans/bank",
      });
    }
    // Track which card-account-ids already produced a CardStatement-based
    // due so the manual/fallback path doesn't double-count them.
    const cardAccountsWithStatement = new Set<string>();
    for (const s of upcomingCardBills) {
      const paid = s.payments.reduce((acc, p) => acc + Number(p.amount), 0);
      const total = Number(s.totalDue);
      const outstanding = Math.max(0, total - paid);
      cardAccountsWithStatement.add(s.account.id);
      if (outstanding === 0) continue;
      const cardId = s.account.linkedCard?.id ?? null;
      dues.push({
        id: `card-statement:${s.id}`,
        source: "CARD_STATEMENT",
        kind: "CARD BILL",
        label: s.account.name,
        dueDate: s.dueDate.toISOString(),
        amount: outstanding,
        ...(paid > 0 ? { total, paid: Math.min(total, paid) } : {}),
        href: cardId ? `/cards/${cardId}` : "/cards",
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
            href: linkedCardId ? `/cards/${linkedCardId}` : "/cards",
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
      dues.push({
        id: `card-computed:${a.id}`,
        source: "CARD_STATEMENT",
        kind: "CARD BILL",
        label: a.name,
        dueDate: computedDue.toISOString(),
        amount: computedAmount,
        href: linkedCardId ? `/cards/${linkedCardId}` : "/cards",
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
      });
    }
    dues.sort((a, b) => a.dueDate.localeCompare(b.dueDate));

    // Split the dues list into "this calendar month" vs "next calendar
    // month onward (within the 30-day lookahead)". Two distinct buckets
    // by month boundary so the labels are unambiguous — `currentMonthDue`
    // is the cashflow need for the rest of this month, `nextMonthDue` is
    // what's queued up after the month rolls over.
    const thisMonthStart = Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      1,
    );
    const nextMonthStart = Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth() + 1,
      1,
    );
    let currentMonthDue = 0;
    let nextMonthDue = 0;
    for (const d of dues) {
      if (d.amount == null) continue;
      const t = new Date(d.dueDate).getTime();
      if (t >= thisMonthStart && t < nextMonthStart) {
        currentMonthDue += d.amount;
      } else if (t >= nextMonthStart) {
        nextMonthDue += d.amount;
      }
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
      currentMonthDue,
      nextMonthDue,
      activeCropBatches,
      activeLivestockBatches,
      pendingSettlements,
      dues,
    });
  } catch (e) {
    return err(e);
  }
}
