import { NextResponse } from "next/server";
import { LivestockEventType } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { livestockEventUpdateSchema } from "@/lib/validators-domain";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[events/[id]]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

async function loadEvent(batchId: string, eventId: string, workspaceId: string) {
  const row = await prisma.livestockEvent.findUnique({
    where: { id: eventId },
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

/** PURCHASE/BIRTH add to head count; DEATH/SALE subtract. */
function signedDelta(eventType: LivestockEventType, count: number): number {
  return eventType === "PURCHASE" || eventType === "BIRTH"
    ? count
    : -count;
}

/**
 * Edit a livestock event. Recomputes the head-count delta if either
 * `eventType` or `count` changes (transaction-bracketed so the count
 * never drifts even if a partial update fails). Money-affecting fields
 * (`unitValue`, weights) are locked when a Transaction is already
 * linked — re-pricing means delete + recreate so the linked txn stays
 * honest.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; eventId: string }> },
) {
  try {
    const ctx = await requireWorkspace("livestock", "write");
    const { id, eventId } = await context.params;
    const existing = await loadEvent(id, eventId, ctx.workspaceId);
    if (!existing)
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    const body = await request.json();
    const parsed = livestockEventUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const d = parsed.data;

    // Lock money fields once a Transaction is linked.
    if (existing.transactionId) {
      const moneyChanged =
        (d.unitValue !== undefined &&
          Number(d.unitValue) !== Number(existing.unitValue ?? 0)) ||
        (d.avgWeightKg !== undefined &&
          Number(d.avgWeightKg) !== Number(existing.avgWeightKg ?? 0)) ||
        (d.totalWeightKg !== undefined &&
          Number(d.totalWeightKg) !== Number(existing.totalWeightKg ?? 0));
      if (moneyChanged) {
        return NextResponse.json(
          {
            error:
              "Delete and re-add this event to change the price / weights — keeps the linked transaction honest.",
          },
          { status: 409 },
        );
      }
    }

    const newEventType = (d.eventType ??
      existing.eventType) as LivestockEventType;
    const newCount = d.count ?? existing.count;

    // Compute the head-count delta: undo the old event's effect, apply
    // the new one. If the net change drops the count below zero, refuse.
    const oldDelta = signedDelta(
      existing.eventType as LivestockEventType,
      existing.count,
    );
    const newDelta = signedDelta(newEventType, newCount);
    const netDelta = newDelta - oldDelta;
    if (existing.batch.currentCount + netDelta < 0) {
      return NextResponse.json(
        {
          error: `Edit would leave the batch with a negative head count (currently ${existing.batch.currentCount}).`,
        },
        { status: 400 },
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.livestockEvent.update({
        where: { id: eventId },
        data: {
          eventType: newEventType,
          date: d.date ? new Date(d.date) : existing.date,
          count: newCount,
          notes: d.notes === undefined ? existing.notes : (d.notes ?? null),
        },
      });
      if (netDelta !== 0) {
        await tx.livestockBatch.update({
          where: { id },
          data: { currentCount: { increment: netDelta } },
        });
      }
      // If the date moved + a txn is linked, keep the txn's date in
      // step so cashflow buckets line up.
      if (existing.transactionId && d.date) {
        await tx.transaction.update({
          where: { id: existing.transactionId },
          data: { date: new Date(d.date) },
        });
      }
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}

/**
 * Delete a livestock event. Reverses the head-count delta and removes
 * the linked Transaction (if any) inside one $transaction.
 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; eventId: string }> },
) {
  try {
    const ctx = await requireWorkspace("livestock", "write");
    const { id, eventId } = await context.params;
    const existing = await loadEvent(id, eventId, ctx.workspaceId);
    if (!existing)
      return NextResponse.json({ error: "Not found" }, { status: 404 });

    const reverse = -signedDelta(
      existing.eventType as LivestockEventType,
      existing.count,
    );
    if (existing.batch.currentCount + reverse < 0) {
      return NextResponse.json(
        {
          error: `Deleting this event would leave the batch with a negative head count. Reverse the later movements first.`,
        },
        { status: 400 },
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.livestockEvent.delete({ where: { id: eventId } });
      if (existing.transactionId) {
        await tx.transaction.delete({
          where: { id: existing.transactionId },
        });
      }
      if (reverse !== 0) {
        await tx.livestockBatch.update({
          where: { id },
          data: { currentCount: { increment: reverse } },
        });
      }
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}
