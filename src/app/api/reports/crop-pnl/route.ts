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

    const batches = await prisma.cropBatch.findMany({
      where: { crop: { workspaceId: ctx.workspaceId } },
      include: { crop: { select: { id: true, name: true } } },
      orderBy: [{ active: "desc" }, { startDate: "desc" }],
    });

    const rows = await Promise.all(
      batches.map(async (b) => {
        const [income, expense] = await Promise.all([
          prisma.transaction.aggregate({
            where: { cropBatchId: b.id, type: "INCOME", transferId: null },
            _sum: { amount: true },
          }),
          prisma.transaction.aggregate({
            where: { cropBatchId: b.id, type: "EXPENSE", transferId: null },
            _sum: { amount: true },
          }),
        ]);
        const inc = Number(income._sum.amount ?? 0);
        const exp = Number(expense._sum.amount ?? 0);
        return {
          batchId: b.id,
          batchName: b.name,
          crop: b.crop,
          status: b.status,
          active: b.active,
          startDate: b.startDate?.toISOString() ?? null,
          endDate: b.endDate?.toISOString() ?? null,
          income: Math.round(inc * 100) / 100,
          expense: Math.round(exp * 100) / 100,
          net: Math.round((inc - exp) * 100) / 100,
        };
      })
    );

    // Aggregate by crop
    const byCrop = new Map<
      string,
      { id: string; name: string; income: number; expense: number; net: number; batches: number }
    >();
    for (const r of rows) {
      const k = r.crop.id;
      const existing = byCrop.get(k) ?? {
        id: r.crop.id,
        name: r.crop.name,
        income: 0,
        expense: 0,
        net: 0,
        batches: 0,
      };
      existing.income += r.income;
      existing.expense += r.expense;
      existing.net += r.net;
      existing.batches += 1;
      byCrop.set(k, existing);
    }

    return NextResponse.json({
      batches: rows,
      byCrop: Array.from(byCrop.values()).map((c) => ({
        ...c,
        income: Math.round(c.income * 100) / 100,
        expense: Math.round(c.expense * 100) / 100,
        net: Math.round(c.net * 100) / 100,
      })),
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
