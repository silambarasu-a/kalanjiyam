import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { canAccessRecord } from "@/lib/permissions";
import { feedLogCreateSchema } from "@/lib/validators-domain";
import { TransactionType, TransactionKind } from "@/generated/prisma/client";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
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
    const parsed = feedLogCreateSchema.safeParse(body);
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
    if (!resolvedAccountId) {
      return NextResponse.json({ error: "Pick an account or card" }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const txn = await tx.transaction.create({
        data: {
          workspaceId: ctx.workspaceId,
          type: TransactionType.EXPENSE,
          kind: TransactionKind.FEED,
          amount: data.amount,
          description: `Feed${data.notes ? ` · ${data.notes}` : ""}`,
          date: new Date(data.date),
          accountId: resolvedAccountId,
          cardId: data.cardId ?? null,
          livestockBatchId: id,
          userId: ctx.userId,
          createdByUserId: ctx.userId,
        },
      });
      return tx.feedLog.create({
        data: {
          batchId: id,
          date: new Date(data.date),
          amount: data.amount,
          quantity: data.quantity ?? null,
          unit: data.unit,
          notes: data.notes,
          transactionId: txn.id,
        },
      });
    });
    return NextResponse.json({ id: result.id });
  } catch (e) {
    return err(e);
  }
}
