import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { canAccessRecord } from "@/lib/permissions";
import { livestockEventCreateSchema } from "@/lib/validators-domain";
import { TransactionType, LivestockEventType } from "@/generated/prisma/client";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[livestock-events]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireWorkspace("livestock", "write");
    const session = await auth();
    const { id } = await context.params;

    const body = await request.json();
    const parsed = livestockEventCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const data = parsed.data;

    const batch = await prisma.livestockBatch.findUnique({
      where: { id },
      include: { livestock: { select: { workspaceId: true } } },
    });
    if (!batch || batch.livestock.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    let resolvedAccountId: string | null = data.accountId ?? null;
    if (data.cardId) {
      const card = await prisma.card.findUnique({ where: { id: data.cardId } });
      if (!card || card.workspaceId !== ctx.workspaceId) {
        return NextResponse.json({ error: "Card not found" }, { status: 404 });
      }
      if (!canAccessRecord(session, card)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      resolvedAccountId = card.accountId ?? resolvedAccountId;
    }

    const isFinancial = data.eventType === "PURCHASE" || data.eventType === "SALE";
    if (isFinancial && !resolvedAccountId) {
      return NextResponse.json(
        { error: "Pick an account or card for purchase/sale" },
        { status: 400 }
      );
    }

    if (data.eventType === "DEATH" && data.count > batch.currentCount) {
      return NextResponse.json(
        { error: `Only ${batch.currentCount} animals in this batch` },
        { status: 400 }
      );
    }
    if (data.eventType === "SALE" && data.count > batch.currentCount) {
      return NextResponse.json(
        { error: `Only ${batch.currentCount} animals available to sell` },
        { status: 400 }
      );
    }

    const delta =
      data.eventType === "PURCHASE" || data.eventType === "BIRTH"
        ? data.count
        : -data.count;
    const totalAmount =
      data.unitValue != null ? Number((data.unitValue * data.count).toFixed(2)) : 0;

    const created = await prisma.$transaction(async (tx) => {
      let txnId: string | null = null;
      if (isFinancial && totalAmount > 0) {
        const txn = await tx.transaction.create({
          data: {
            workspaceId: ctx.workspaceId,
            type:
              data.eventType === "SALE"
                ? TransactionType.INCOME
                : TransactionType.EXPENSE,
            amount: totalAmount,
            description: `${data.eventType === "SALE" ? "Sale" : "Purchase"} of ${data.count} (${data.notes ?? "livestock"})`,
            date: new Date(data.date),
            accountId: resolvedAccountId,
            cardId: data.cardId ?? null,
            livestockBatchId: id,
            userId: ctx.userId,
            createdByUserId: ctx.userId,
          },
        });
        txnId = txn.id;
      }
      const evt = await tx.livestockEvent.create({
        data: {
          batchId: id,
          eventType: data.eventType as LivestockEventType,
          date: new Date(data.date),
          count: data.count,
          unitValue: data.unitValue ?? null,
          notes: data.notes,
          transactionId: txnId,
        },
      });
      await tx.livestockBatch.update({
        where: { id },
        data: { currentCount: { increment: delta } },
      });
      return evt;
    });

    return NextResponse.json({ id: created.id });
  } catch (e) {
    return err(e);
  }
}
