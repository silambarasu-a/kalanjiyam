import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { feedLogUpdateSchema } from "@/lib/validators-domain";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[feed/[id]]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

async function loadFeed(
  batchId: string,
  feedId: string,
  workspaceId: string,
) {
  const row = await prisma.feedLog.findUnique({
    where: { id: feedId },
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

/**
 * Edit a feed log. `amount` is locked because it's mirrored on the
 * linked EXPENSE Transaction — re-pricing means delete + recreate so
 * cashflow stays honest. Quantity / unit / date / notes are safe to
 * adjust; if the date moves, we sync the linked Transaction's date too
 * so the cashflow chart bucket follows.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; feedId: string }> },
) {
  try {
    const ctx = await requireWorkspace("livestock", "write");
    const { id, feedId } = await context.params;
    const existing = await loadFeed(id, feedId, ctx.workspaceId);
    if (!existing)
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    const body = await request.json();
    const parsed = feedLogUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const d = parsed.data;
    const newDate = d.date ? new Date(d.date) : existing.date;

    await prisma.$transaction(async (tx) => {
      await tx.feedLog.update({
        where: { id: feedId },
        data: {
          date: newDate,
          quantity:
            d.quantity === undefined
              ? existing.quantity
              : (d.quantity ?? null),
          unit: d.unit === undefined ? existing.unit : (d.unit ?? null),
          notes: d.notes === undefined ? existing.notes : (d.notes ?? null),
        },
      });
      // Keep the linked Transaction's date in step so cashflow rolls
      // bucket correctly. Amount stays locked.
      if (existing.transactionId && d.date && d.date !== existing.date.toISOString()) {
        await tx.transaction.update({
          where: { id: existing.transactionId },
          data: { date: newDate },
        });
      }
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}

/**
 * Delete a feed log. Cascades the linked EXPENSE Transaction in the
 * same $transaction so cashflow + feed history stay consistent.
 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; feedId: string }> },
) {
  try {
    const ctx = await requireWorkspace("livestock", "write");
    const { id, feedId } = await context.params;
    const existing = await loadFeed(id, feedId, ctx.workspaceId);
    if (!existing)
      return NextResponse.json({ error: "Not found" }, { status: 404 });

    await prisma.$transaction(async (tx) => {
      await tx.feedLog.delete({ where: { id: feedId } });
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
