import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { mortalityLogUpdateSchema } from "@/lib/validators-domain";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[mortality/[id]]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

async function loadMortality(
  batchId: string,
  mortalityId: string,
  workspaceId: string,
) {
  const row = await prisma.mortalityLog.findUnique({
    where: { id: mortalityId },
    include: {
      batch: {
        select: {
          id: true,
          currentCount: true,
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

/**
 * Edit a mortality log. If `count` changes, adjust the batch's
 * currentCount by the delta inside a single $transaction so the books
 * stay consistent (per the planning agreement to mirror cascade-revert
 * semantics on other money/count-moving rows).
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; mortalityId: string }> },
) {
  try {
    const ctx = await requireWorkspace("livestock", "write");
    const { id, mortalityId } = await context.params;
    const existing = await loadMortality(id, mortalityId, ctx.workspaceId);
    if (!existing)
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    const body = await request.json();
    const parsed = mortalityLogUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const d = parsed.data;
    const newCount = d.count ?? existing.count;
    const delta = newCount - existing.count;
    if (delta > 0 && delta > existing.batch.currentCount) {
      return NextResponse.json(
        {
          error: `Only ${existing.batch.currentCount} live animals — can't increase deaths by ${delta}`,
        },
        { status: 400 },
      );
    }
    await prisma.$transaction(async (tx) => {
      await tx.mortalityLog.update({
        where: { id: mortalityId },
        data: {
          date: d.date ? new Date(d.date) : existing.date,
          count: newCount,
          cause: d.cause ?? existing.cause,
          culled: d.culled ?? existing.culled,
          notes: d.notes === undefined ? existing.notes : (d.notes ?? null),
        },
      });
      if (delta !== 0) {
        await tx.livestockBatch.update({
          where: { id },
          data: { currentCount: { decrement: delta } },
        });
      }
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}

/**
 * Delete a mortality log and refund the batch's `currentCount`. If the
 * record was tied to a specific animal, also flip that animal back to
 * active (the planning round confirmed this auto-restore behaviour).
 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; mortalityId: string }> },
) {
  try {
    const ctx = await requireWorkspace("livestock", "write");
    const { id, mortalityId } = await context.params;
    const existing = await loadMortality(id, mortalityId, ctx.workspaceId);
    if (!existing)
      return NextResponse.json({ error: "Not found" }, { status: 404 });

    await prisma.$transaction(async (tx) => {
      await tx.mortalityLog.delete({ where: { id: mortalityId } });
      await tx.livestockBatch.update({
        where: { id },
        data: { currentCount: { increment: existing.count } },
      });
      if (existing.animalId) {
        await tx.livestockAnimal.update({
          where: { id: existing.animalId },
          data: { active: true },
        });
      }
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}
