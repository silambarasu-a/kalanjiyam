import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { computeWorkerBalance } from "@/lib/worker-balance";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[farm.overview]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function GET() {
  try {
    const ctx = await requireWorkspace("crops", "read");
    const wsId = ctx.workspaceId;

    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const [
      cropsActive,
      cropsTotal,
      livestockBatchesActive,
      livestockHeadAgg,
      leasesActive,
      activeWorkerIds,
      monthWageAgg,
      advanceAgg,
      repaidAgg,
    ] = await Promise.all([
      prisma.crop.count({ where: { workspaceId: wsId, active: true } }),
      prisma.crop.count({ where: { workspaceId: wsId } }),
      prisma.livestockBatch.count({
        where: { livestock: { workspaceId: wsId }, active: true },
      }),
      prisma.livestockBatch.aggregate({
        where: { livestock: { workspaceId: wsId }, active: true },
        _sum: { currentCount: true },
      }),
      prisma.lease.count({
        where: { workspaceId: wsId, active: true },
      }),
      prisma.worker
        .findMany({
          where: { workspaceId: wsId, active: true, archivedAt: null },
          select: { id: true },
        })
        .then((rows) => rows.map((r) => r.id)),
      prisma.wagePayment.aggregate({
        where: {
          worker: { workspaceId: wsId },
          paidAt: { gte: monthStart },
          isBonus: false,
        },
        _sum: { amount: true },
      }),
      prisma.wagePayment.aggregate({
        where: {
          worker: { workspaceId: wsId },
          isAdvance: true,
          isBonus: false,
        },
        _sum: { amount: true },
      }),
      prisma.advanceRepayment.aggregate({
        where: { workspaceId: wsId, reversedAt: null },
        _sum: { amount: true },
      }),
    ]);

    const balances = await Promise.all(
      activeWorkerIds.map((id) => computeWorkerBalance(id).catch(() => null)),
    );
    const owedTotal = balances.reduce(
      (sum, b) => sum + (b && b.balance > 0 ? b.balance : 0),
      0,
    );

    const monthWagePaid = Number(monthWageAgg._sum.amount ?? 0);
    const repaid = Number(repaidAgg._sum.amount ?? 0);
    const monthWagePaidNet = Math.max(0, monthWagePaid);
    const outstandingAdvances = Math.max(
      0,
      Number(advanceAgg._sum.amount ?? 0) - repaid,
    );

    return NextResponse.json({
      crops: { active: cropsActive, total: cropsTotal },
      livestock: {
        active: livestockBatchesActive,
        head: Number(livestockHeadAgg._sum.currentCount ?? 0),
      },
      leases: { active: leasesActive },
      workers: {
        active: activeWorkerIds.length,
        owedTotal: round2(owedTotal),
      },
      wages: {
        thisMonthPaid: round2(monthWagePaidNet),
        outstandingAdvances: round2(outstandingAdvances),
      },
    });
  } catch (e) {
    return err(e);
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
