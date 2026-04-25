import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { cropBatchUpdateSchema } from "@/lib/validators-domain";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

async function loadBatch(id: string, workspaceId: string) {
  const batch = await prisma.cropBatch.findUnique({
    where: { id },
    include: { crop: { select: { workspaceId: true } } },
  });
  if (!batch || batch.crop.workspaceId !== workspaceId) return null;
  return batch;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireWorkspace("crops", "read");
    const { id } = await context.params;
    const batch = await loadBatch(id, ctx.workspaceId);
    if (!batch) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const [incomeAgg, expenseAgg, txnCount] = await Promise.all([
      prisma.transaction.aggregate({
        where: { cropBatchId: id, type: "INCOME" },
        _sum: { amount: true },
      }),
      prisma.transaction.aggregate({
        where: { cropBatchId: id, type: "EXPENSE" },
        _sum: { amount: true },
      }),
      prisma.transaction.count({ where: { cropBatchId: id } }),
    ]);

    return NextResponse.json({
      batch: {
        id: batch.id,
        name: batch.name,
        status: batch.status,
        startDate: batch.startDate?.toISOString() ?? null,
        endDate: batch.endDate?.toISOString() ?? null,
        expectedCycleDays: batch.expectedCycleDays,
        notes: batch.notes,
        active: batch.active,
        cropId: batch.cropId,
        landId: batch.landId,
      },
      summary: {
        income: Number(incomeAgg._sum.amount ?? 0),
        expense: Number(expenseAgg._sum.amount ?? 0),
        net: Number(incomeAgg._sum.amount ?? 0) - Number(expenseAgg._sum.amount ?? 0),
        transactions: txnCount,
      },
    });
  } catch (e) {
    return err(e);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireWorkspace("crops", "write");
    const { id } = await context.params;
    const batch = await loadBatch(id, ctx.workspaceId);
    if (!batch) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const body = await request.json();
    const parsed = cropBatchUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    if (parsed.data.landId) {
      const land = await prisma.land.findUnique({ where: { id: parsed.data.landId } });
      if (!land || land.workspaceId !== ctx.workspaceId) {
        return NextResponse.json({ error: "Land not found" }, { status: 404 });
      }
    }
    const updated = await prisma.cropBatch.update({
      where: { id },
      data: {
        name: parsed.data.name ?? batch.name,
        status: parsed.data.status ?? batch.status,
        startDate:
          parsed.data.startDate === undefined
            ? batch.startDate
            : parsed.data.startDate
              ? new Date(parsed.data.startDate)
              : null,
        endDate:
          parsed.data.endDate === undefined
            ? batch.endDate
            : parsed.data.endDate
              ? new Date(parsed.data.endDate)
              : null,
        expectedCycleDays:
          parsed.data.expectedCycleDays === undefined
            ? batch.expectedCycleDays
            : parsed.data.expectedCycleDays,
        notes: parsed.data.notes ?? batch.notes,
        active: parsed.data.active ?? batch.active,
        landId: parsed.data.landId === undefined ? batch.landId : parsed.data.landId,
      },
    });
    return NextResponse.json({ id: updated.id });
  } catch (e) {
    return err(e);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireWorkspace("crops", "write");
    const { id } = await context.params;
    const batch = await loadBatch(id, ctx.workspaceId);
    if (!batch) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const txCount = await prisma.transaction.count({ where: { cropBatchId: id } });
    if (txCount > 0) {
      return NextResponse.json(
        { error: "Batch has transactions — close it (status=CLOSED) instead of deleting." },
        { status: 400 }
      );
    }
    await prisma.cropBatch.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}
