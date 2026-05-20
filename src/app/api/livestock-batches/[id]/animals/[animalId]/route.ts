import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { livestockAnimalUpdateSchema } from "@/lib/validators-domain";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[animals/[id]]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

async function loadAnimal(
  batchId: string,
  animalId: string,
  workspaceId: string,
) {
  const row = await prisma.livestockAnimal.findUnique({
    where: { id: animalId },
    include: {
      batch: {
        select: { id: true, livestock: { select: { workspaceId: true } } },
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
  context: { params: Promise<{ id: string; animalId: string }> },
) {
  try {
    const ctx = await requireWorkspace("livestock", "write");
    const { id, animalId } = await context.params;
    const existing = await loadAnimal(id, animalId, ctx.workspaceId);
    if (!existing)
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    const body = await request.json();
    const parsed = livestockAnimalUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const d = parsed.data;
    await prisma.livestockAnimal.update({
      where: { id: animalId },
      data: {
        tagNumber: d.tagNumber ?? existing.tagNumber,
        name: d.name === undefined ? existing.name : (d.name ?? null),
        sex: d.sex ?? existing.sex,
        dob:
          d.dob === undefined
            ? existing.dob
            : d.dob
              ? new Date(d.dob)
              : null,
        breed: d.breed === undefined ? existing.breed : (d.breed ?? null),
        color: d.color === undefined ? existing.color : (d.color ?? null),
        notes: d.notes === undefined ? existing.notes : (d.notes ?? null),
        active: d.active ?? existing.active,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}

/**
 * Hard-deletes the animal row. Refuses (409) when weighings or
 * mortality reference it — caller should soft-archive via active=false
 * instead, preserving history.
 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; animalId: string }> },
) {
  try {
    const ctx = await requireWorkspace("livestock", "write");
    const { id, animalId } = await context.params;
    const existing = await loadAnimal(id, animalId, ctx.workspaceId);
    if (!existing)
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    const [weighings, mortality] = await Promise.all([
      prisma.weighingLog.count({ where: { animalId } }),
      prisma.mortalityLog.count({ where: { animalId } }),
    ]);
    if (weighings + mortality > 0) {
      return NextResponse.json(
        {
          error: `Animal has ${weighings} weighing${weighings === 1 ? "" : "s"} + ${mortality} mortality row${mortality === 1 ? "" : "s"} — set inactive instead.`,
        },
        { status: 409 },
      );
    }
    await prisma.livestockAnimal.delete({ where: { id: animalId } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}
