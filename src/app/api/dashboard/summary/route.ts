import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { computeAccountBalance } from "@/lib/account-balance";
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
      pendingSettlements,
      outstandingCharges,
      activeLoans,
      investmentsTotal,
      monthIncomeAgg,
      monthExpenseAgg,
    ] = await Promise.all([
      prisma.account.findMany({
        where: { workspaceId: wsId },
        select: { id: true, kind: true },
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
      source: "REMINDER" | "LOAN" | "LEASE";
      kind: string;
      label: string;
      dueDate: string;
      amount: number | null;
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
      activeCropBatches,
      activeLivestockBatches,
      pendingSettlements,
      dues,
    });
  } catch (e) {
    return err(e);
  }
}
