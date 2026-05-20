import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { weighingLogCreateSchema } from "@/lib/validators-domain";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[weighings]", e);
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
    const rows = await prisma.weighingLog.findMany({
      where: { batchId: id },
      orderBy: { date: "desc" },
    });
    return NextResponse.json({
      weighings: rows.map((w) => ({
        id: w.id,
        animalId: w.animalId,
        phase: w.phase,
        date: w.date.toISOString(),
        sampleSize: w.sampleSize,
        totalKg: Number(w.totalKg),
        avgKg: Number(w.avgKg),
        notes: w.notes,
      })),
    });
  } catch (e) {
    return err(e);
  }
}

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
    const parsed = weighingLogCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const d = parsed.data;
    if (d.animalId) {
      const animal = await prisma.livestockAnimal.findUnique({
        where: { id: d.animalId },
        select: { batchId: true },
      });
      if (!animal || animal.batchId !== id) {
        return NextResponse.json({ error: "Animal not found" }, { status: 404 });
      }
    }
    const avgKg = +(d.totalKg / d.sampleSize).toFixed(3);
    const row = await prisma.weighingLog.create({
      data: {
        batchId: id,
        animalId: d.animalId ?? null,
        phase: d.phase,
        date: new Date(d.date),
        sampleSize: d.sampleSize,
        totalKg: d.totalKg,
        avgKg,
        notes: d.notes ?? null,
      },
    });
    return NextResponse.json({ id: row.id });
  } catch (e) {
    return err(e);
  }
}
