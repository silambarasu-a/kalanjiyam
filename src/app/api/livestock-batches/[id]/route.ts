import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { livestockBatchUpdateSchema } from "@/lib/validators-domain";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

async function loadBatch(id: string, workspaceId: string) {
  const batch = await prisma.livestockBatch.findUnique({
    where: { id },
    include: { livestock: { select: { workspaceId: true } } },
  });
  if (!batch || batch.livestock.workspaceId !== workspaceId) return null;
  return batch;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireWorkspace("livestock", "read");
    const { id } = await context.params;
    const batch = await loadBatch(id, ctx.workspaceId);
    if (!batch) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const [events, feedLogs, vaccinations, incomeAgg, expenseAgg] = await Promise.all([
      prisma.livestockEvent.findMany({
        where: { batchId: id },
        orderBy: { date: "desc" },
      }),
      prisma.feedLog.findMany({ where: { batchId: id }, orderBy: { date: "desc" }, take: 50 }),
      prisma.vaccinationLog.findMany({
        where: { batchId: id },
        orderBy: { date: "desc" },
        take: 50,
      }),
      prisma.transaction.aggregate({
        where: { livestockBatchId: id, type: "INCOME" },
        _sum: { amount: true },
      }),
      prisma.transaction.aggregate({
        where: { livestockBatchId: id, type: "EXPENSE" },
        _sum: { amount: true },
      }),
    ]);

    return NextResponse.json({
      batch: {
        id: batch.id,
        name: batch.name,
        startDate: batch.startDate.toISOString(),
        endDate: batch.endDate?.toISOString() ?? null,
        expectedCycleDays: batch.expectedCycleDays,
        initialCount: batch.initialCount,
        currentCount: batch.currentCount,
        notes: batch.notes,
        active: batch.active,
        livestockId: batch.livestockId,
        landId: batch.landId,
      },
      summary: {
        income: Number(incomeAgg._sum.amount ?? 0),
        expense: Number(expenseAgg._sum.amount ?? 0),
        net: Number(incomeAgg._sum.amount ?? 0) - Number(expenseAgg._sum.amount ?? 0),
      },
      events: events.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        date: e.date.toISOString(),
        count: e.count,
        unitValue: e.unitValue == null ? null : Number(e.unitValue),
        notes: e.notes,
      })),
      feedLogs: feedLogs.map((f) => ({
        id: f.id,
        date: f.date.toISOString(),
        amount: Number(f.amount),
        quantity: f.quantity == null ? null : Number(f.quantity),
        unit: f.unit,
        notes: f.notes,
      })),
      vaccinations: vaccinations.map((v) => ({
        id: v.id,
        vaccine: v.vaccine,
        date: v.date.toISOString(),
        nextDueDate: v.nextDueDate?.toISOString() ?? null,
        cost: v.cost == null ? null : Number(v.cost),
        notes: v.notes,
      })),
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
    const ctx = await requireWorkspace("livestock", "write");
    const { id } = await context.params;
    const batch = await loadBatch(id, ctx.workspaceId);
    if (!batch) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const body = await request.json();
    const parsed = livestockBatchUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const updated = await prisma.livestockBatch.update({
      where: { id },
      data: {
        name: parsed.data.name ?? batch.name,
        startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : batch.startDate,
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
    const ctx = await requireWorkspace("livestock", "write");
    const { id } = await context.params;
    const batch = await loadBatch(id, ctx.workspaceId);
    if (!batch) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const eventCount = await prisma.livestockEvent.count({ where: { batchId: id } });
    if (eventCount > 0) {
      return NextResponse.json(
        { error: "Batch has events — close it (active=false) instead of deleting." },
        { status: 400 }
      );
    }
    await prisma.livestockBatch.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}
