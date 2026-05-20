import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { eggLogUpdateSchema } from "@/lib/validators-domain";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[eggs/[id]]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

async function loadEgg(batchId: string, eggId: string, workspaceId: string) {
  const row = await prisma.eggProductionLog.findUnique({
    where: { id: eggId },
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
 * Edit an egg log. Same constraint as MilkLog: if a sale Transaction is
 * already linked, refuse to silently re-price it — caller must delete +
 * recreate. Keeps the cashflow figure honest.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; eggId: string }> },
) {
  try {
    const ctx = await requireWorkspace("livestock", "write");
    const { id, eggId } = await context.params;
    const existing = await loadEgg(id, eggId, ctx.workspaceId);
    if (!existing)
      return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = await request.json();
    const parsed = eggLogUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const d = parsed.data;

    if (existing.transactionId) {
      const wantsSaleChange =
        (d.sold !== undefined && d.sold !== existing.sold) ||
        (d.salePricePerEgg !== undefined &&
          Number(d.salePricePerEgg) !==
            Number(existing.salePricePerEgg ?? 0));
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

    const newCollected = d.collected ?? existing.collected;
    const sold =
      d.sold === undefined ? existing.sold : d.sold;
    const broken =
      d.broken === undefined ? existing.broken : d.broken;
    if ((sold ?? 0) + (broken ?? 0) > newCollected) {
      return NextResponse.json(
        { error: "Sold + broken can't exceed collected" },
        { status: 400 },
      );
    }

    await prisma.eggProductionLog.update({
      where: { id: eggId },
      data: {
        date: d.date ? new Date(d.date) : existing.date,
        collected: newCollected,
        grades:
          d.grades === undefined
            ? undefined
            : d.grades == null
              ? Prisma.JsonNull
              : (d.grades as Prisma.InputJsonValue),
        broken: broken ?? null,
        notes: d.notes === undefined ? existing.notes : (d.notes ?? null),
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}

/**
 * Delete an egg log. If a linked Transaction exists, delete that first
 * inside a single $transaction so cashflow + production stay consistent.
 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; eggId: string }> },
) {
  try {
    const ctx = await requireWorkspace("livestock", "write");
    const { id, eggId } = await context.params;
    const existing = await loadEgg(id, eggId, ctx.workspaceId);
    if (!existing)
      return NextResponse.json({ error: "Not found" }, { status: 404 });

    await prisma.$transaction(async (tx) => {
      await tx.eggProductionLog.delete({ where: { id: eggId } });
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
