import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function GET() {
  try {
    const ctx = await requireWorkspace("reports", "read");

    const batches = await prisma.livestockBatch.findMany({
      where: { livestock: { workspaceId: ctx.workspaceId } },
      include: { livestock: { select: { id: true, name: true } } },
      orderBy: [{ active: "desc" }, { startDate: "desc" }],
    });

    const rows = await Promise.all(
      batches.map(async (b) => {
        const [income, expense] = await Promise.all([
          prisma.transaction.aggregate({
            where: { livestockBatchId: b.id, type: "INCOME", transferId: null },
            _sum: { amount: true },
          }),
          prisma.transaction.aggregate({
            where: { livestockBatchId: b.id, type: "EXPENSE", transferId: null },
            _sum: { amount: true },
          }),
        ]);
        const inc = Number(income._sum.amount ?? 0);
        const exp = Number(expense._sum.amount ?? 0);
        return {
          batchId: b.id,
          batchName: b.name,
          livestock: b.livestock,
          active: b.active,
          initialCount: b.initialCount,
          currentCount: b.currentCount,
          startDate: b.startDate.toISOString(),
          endDate: b.endDate?.toISOString() ?? null,
          income: Math.round(inc * 100) / 100,
          expense: Math.round(exp * 100) / 100,
          net: Math.round((inc - exp) * 100) / 100,
        };
      })
    );

    return NextResponse.json({
      batches: rows,
      totals: rows.reduce(
        (acc, r) => ({
          income: acc.income + r.income,
          expense: acc.expense + r.expense,
          net: acc.net + r.net,
        }),
        { income: 0, expense: 0, net: 0 }
      ),
    });
  } catch (e) {
    return err(e);
  }
}
