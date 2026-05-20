import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { healthLogUpdateSchema } from "@/lib/validators-domain";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[health/[id]]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

async function loadHealth(
  batchId: string,
  healthId: string,
  workspaceId: string,
) {
  const row = await prisma.healthLog.findUnique({
    where: { id: healthId },
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

/**
 * Edit a health log. Same rule as Milk + Egg: if a linked Transaction
 * is already in the books, refuse to silently re-price it; force a
 * delete + recreate. Resolving / unresolving and editing notes is
 * always safe.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; healthId: string }> },
) {
  try {
    const ctx = await requireWorkspace("livestock", "write");
    const { id, healthId } = await context.params;
    const existing = await loadHealth(id, healthId, ctx.workspaceId);
    if (!existing)
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    const body = await request.json();
    const parsed = healthLogUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const d = parsed.data;

    if (
      existing.transactionId &&
      d.cost !== undefined &&
      Number(d.cost) !== Number(existing.cost ?? 0)
    ) {
      return NextResponse.json(
        {
          error:
            "Delete and re-add this log to change the cost — keeps the linked transaction honest.",
        },
        { status: 409 },
      );
    }

    await prisma.healthLog.update({
      where: { id: healthId },
      data: {
        animalId:
          d.animalId === undefined
            ? existing.animalId
            : (d.animalId ?? null),
        date: d.date ? new Date(d.date) : existing.date,
        condition: d.condition ?? existing.condition,
        treatment:
          d.treatment === undefined
            ? existing.treatment
            : (d.treatment ?? null),
        resolved: d.resolved ?? existing.resolved,
        resolvedAt:
          d.resolvedAt === undefined
            ? existing.resolvedAt
            : d.resolvedAt
              ? new Date(d.resolvedAt)
              : null,
        notes: d.notes === undefined ? existing.notes : (d.notes ?? null),
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}

/**
 * Delete a health log. If a linked EXPENSE Transaction exists, delete
 * that first inside the same $transaction so cashflow stays consistent.
 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; healthId: string }> },
) {
  try {
    const ctx = await requireWorkspace("livestock", "write");
    const { id, healthId } = await context.params;
    const existing = await loadHealth(id, healthId, ctx.workspaceId);
    if (!existing)
      return NextResponse.json({ error: "Not found" }, { status: 404 });

    await prisma.$transaction(async (tx) => {
      await tx.healthLog.delete({ where: { id: healthId } });
      if (existing.transactionId) {
        await tx.transaction.delete({
          where: { id: existing.transactionId },
        });
      }
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}
