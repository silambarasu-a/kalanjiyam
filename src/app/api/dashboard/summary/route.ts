import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { computeAccountBalance } from "@/lib/account-balance";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[dashboard]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function GET() {
  try {
    const ctx = await requireWorkspace("dashboard", "read");
    const wsId = ctx.workspaceId;

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const in14days = new Date(now);
    in14days.setDate(in14days.getDate() + 14);

    const [
      accounts,
      activeCropBatches,
      activeLivestockBatches,
      upcomingReminders,
      pendingSettlements,
      outstandingCharges,
      activeLoans,
      investmentsTotal,
      monthIncomeAgg,
      monthExpenseAgg,
    ] = await Promise.all([
      prisma.account.findMany({ where: { workspaceId: wsId }, select: { id: true, kind: true } }),
      prisma.cropBatch.count({
        where: { active: true, crop: { workspaceId: wsId } },
      }),
      prisma.livestockBatch.count({
        where: { active: true, livestock: { workspaceId: wsId } },
      }),
      prisma.investmentReminder.findMany({
        where: { workspaceId: wsId, status: "UPCOMING", dueDate: { lte: in14days } },
        orderBy: { dueDate: "asc" },
        take: 8,
        include: { investment: { select: { name: true } } },
      }),
      prisma.wageSettlement.count({ where: { worker: { workspaceId: wsId }, status: "PENDING" } }),
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
          date: { gte: monthStart },
          transferId: null,
        },
        _sum: { amount: true },
      }),
      prisma.transaction.aggregate({
        where: {
          workspaceId: wsId,
          type: "EXPENSE",
          date: { gte: monthStart },
          transferId: null,
        },
        _sum: { amount: true },
      }),
    ]);

    const bankCashBalances = await Promise.all(
      accounts.filter((a) => a.kind !== "CARD").map((a) => computeAccountBalance(a.id))
    );
    const cardBalances = await Promise.all(
      accounts.filter((a) => a.kind === "CARD").map((a) => computeAccountBalance(a.id))
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

    return NextResponse.json({
      month: {
        income: Number(monthIncomeAgg._sum.amount ?? 0),
        expense: Number(monthExpenseAgg._sum.amount ?? 0),
        net:
          Number(monthIncomeAgg._sum.amount ?? 0) - Number(monthExpenseAgg._sum.amount ?? 0),
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
      reminders: upcomingReminders.map((r) => ({
        id: r.id,
        kind: r.kind,
        dueDate: r.dueDate.toISOString(),
        amount: r.amount == null ? null : Number(r.amount),
        name: r.investment?.name ?? "—",
      })),
    });
  } catch (e) {
    return err(e);
  }
}
