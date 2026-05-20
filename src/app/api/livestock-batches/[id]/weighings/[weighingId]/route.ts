import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { weighingLogUpdateSchema } from "@/lib/validators-domain";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[weighings/[id]]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

async function loadWeighing(
  batchId: string,
  weighingId: string,
  workspaceId: string,
) {
  const row = await prisma.weighingLog.findUnique({
    where: { id: weighingId },
    include: {
      batch: {
        select: {
          id: true,
          livestock: { select: { workspaceId: true } },
        },
      },
    },
  });
  if (
    !row ||
    row.batchId !== batchId ||
    row.batch.livestock.workspaceId !== workspaceId
  ) {
    return null;
  }
  return row;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; weighingId: string }> },
) {
  try {
    const ctx = await requireWorkspace("livestock", "write");
    const { id, weighingId } = await context.params;
    const existing = await loadWeighing(id, weighingId, ctx.workspaceId);
    if (!existing)
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    const body = await request.json();
    const parsed = weighingLogUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const d = parsed.data;
    const totalKg = d.totalKg ?? Number(existing.totalKg);
    const sampleSize = d.sampleSize ?? existing.sampleSize;
    await prisma.weighingLog.update({
      where: { id: weighingId },
      data: {
        phase: d.phase ?? existing.phase,
        date: d.date ? new Date(d.date) : existing.date,
        sampleSize,
        totalKg,
        avgKg: +(totalKg / sampleSize).toFixed(3),
        notes: d.notes === undefined ? existing.notes : (d.notes ?? null),
        animalId:
          d.animalId === undefined ? existing.animalId : (d.animalId ?? null),
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; weighingId: string }> },
) {
  try {
    const ctx = await requireWorkspace("livestock", "write");
    const { id, weighingId } = await context.params;
    const existing = await loadWeighing(id, weighingId, ctx.workspaceId);
    if (!existing)
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    await prisma.weighingLog.delete({ where: { id: weighingId } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}
