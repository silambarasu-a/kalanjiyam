import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { mortalityLogCreateSchema } from "@/lib/validators-domain";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[mortality]", e);
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
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireWorkspace("livestock", "read");
    const { id } = await context.params;
    const batch = await loadBatch(id, ctx.workspaceId);
    if (!batch) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const rows = await prisma.mortalityLog.findMany({
      where: { batchId: id },
      orderBy: { date: "desc" },
    });
    return NextResponse.json({
      mortality: rows.map((m) => ({
        id: m.id,
        animalId: m.animalId,
        date: m.date.toISOString(),
        count: m.count,
        cause: m.cause,
        culled: m.culled,
        notes: m.notes,
      })),
    });
  } catch (e) {
    return err(e);
  }
}

/**
 * Record a death (or cull). Decrements `LivestockBatch.currentCount`
 * atomically so the count and the log row stay consistent. If the
 * mortality references a specific animal, that animal is also flipped
 * to inactive.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireWorkspace("livestock", "write");
    const { id } = await context.params;
    const batch = await loadBatch(id, ctx.workspaceId);
    if (!batch) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = await request.json();
    const parsed = mortalityLogCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const d = parsed.data;
    if (d.count > batch.currentCount) {
      return NextResponse.json(
        { error: `Only ${batch.currentCount} animals in this batch` },
        { status: 400 },
      );
    }
    if (d.animalId) {
      const animal = await prisma.livestockAnimal.findUnique({
        where: { id: d.animalId },
        select: { batchId: true },
      });
      if (!animal || animal.batchId !== id) {
        return NextResponse.json({ error: "Animal not found" }, { status: 404 });
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const row = await tx.mortalityLog.create({
        data: {
          batchId: id,
          animalId: d.animalId ?? null,
          date: new Date(d.date),
          count: d.count,
          cause: d.cause,
          culled: d.culled,
          notes: d.notes ?? null,
        },
      });
      await tx.livestockBatch.update({
        where: { id },
        data: { currentCount: { decrement: d.count } },
      });
      if (d.animalId) {
        await tx.livestockAnimal.update({
          where: { id: d.animalId },
          data: { active: false },
        });
      }
      return row.id;
    });
    return NextResponse.json({ id: result });
  } catch (e) {
    return err(e);
  }
}
