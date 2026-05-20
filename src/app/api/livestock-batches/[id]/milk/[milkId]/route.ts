import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { milkLogUpdateSchema } from "@/lib/validators-domain";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[milk/[id]]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

async function loadMilk(batchId: string, milkId: string, workspaceId: string) {
  const row = await prisma.milkLog.findUnique({
    where: { id: milkId },
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
 * Edit a milk log. We only update the production / quality fields and
 * `notes` here — re-pricing a logged sale requires deleting + recreating
 * the row so the linked Transaction stays in sync (no half-edited
 * INCOME amounts). The validator already forbids changing total milk
 * downward below `soldLitres`.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; milkId: string }> },
) {
  try {
    const ctx = await requireWorkspace("livestock", "write");
    const { id, milkId } = await context.params;
    const existing = await loadMilk(id, milkId, ctx.workspaceId);
    if (!existing)
      return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = await request.json();
    const parsed = milkLogUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const d = parsed.data;

    // If a Transaction is linked, the sale total must stay constant —
    // refuse rate / soldLitres changes that would alter the cashflow
    // figure under the user's feet. Force them to delete + recreate.
    if (existing.transactionId) {
      const wantsSaleChange =
        (d.soldLitres !== undefined &&
          Number(d.soldLitres) !== Number(existing.soldLitres ?? 0)) ||
        (d.ratePerLitre !== undefined &&
          Number(d.ratePerLitre) !== Number(existing.ratePerLitre ?? 0));
      if (wantsSaleChange) {
        return NextResponse.json(
          {
            error:
              "Delete this log and re-add it to change the sale amount — keeps the linked transaction honest.",
          },
          { status: 409 },
        );
      }
    }

    const newTotal = d.totalLitres ?? Number(existing.totalLitres);
    const sold =
      d.soldLitres === undefined
        ? (existing.soldLitres == null ? null : Number(existing.soldLitres))
        : d.soldLitres;
    if (sold != null && sold > newTotal) {
      return NextResponse.json(
        { error: "Sold litres can't exceed total milked" },
        { status: 400 },
      );
    }

    await prisma.milkLog.update({
      where: { id: milkId },
      data: {
        animalId:
          d.animalId === undefined
            ? existing.animalId
            : (d.animalId ?? null),
        date: d.date ? new Date(d.date) : existing.date,
        totalLitres: newTotal,
        sessions:
          d.sessions === undefined
            ? undefined
            : d.sessions == null
              ? Prisma.JsonNull
              : (d.sessions as Prisma.InputJsonValue),
        fatPct: d.fatPct === undefined ? existing.fatPct : (d.fatPct ?? null),
        snfPct: d.snfPct === undefined ? existing.snfPct : (d.snfPct ?? null),
        notes: d.notes === undefined ? existing.notes : (d.notes ?? null),
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}

/**
 * Delete a milk log. If a linked Transaction exists, delete that first
 * inside a single $transaction so cashflow + production stay consistent.
 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; milkId: string }> },
) {
  try {
    const ctx = await requireWorkspace("livestock", "write");
    const { id, milkId } = await context.params;
    const existing = await loadMilk(id, milkId, ctx.workspaceId);
    if (!existing)
      return NextResponse.json({ error: "Not found" }, { status: 404 });

    await prisma.$transaction(async (tx) => {
      await tx.milkLog.delete({ where: { id: milkId } });
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
