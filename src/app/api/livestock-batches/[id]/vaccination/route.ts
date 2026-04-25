import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { canAccessRecord } from "@/lib/permissions";
import { vaccinationLogCreateSchema } from "@/lib/validators-domain";
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
    const parsed = vaccinationLogCreateSchema.safeParse(body);
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

    const result = await prisma.$transaction(async (tx) => {
      let txnId: string | null = null;
      if (data.cost && data.cost > 0) {
        if (!resolvedAccountId) {
          throw new Error("Pick an account or card to record cost");
        }
        const txn = await tx.transaction.create({
          data: {
            workspaceId: ctx.workspaceId,
            type: TransactionType.EXPENSE,
            kind: TransactionKind.VACCINATION,
            amount: data.cost,
            description: `Vaccination ${data.vaccine}`,
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
      return tx.vaccinationLog.create({
        data: {
          batchId: id,
          vaccine: data.vaccine,
          date: new Date(data.date),
          nextDueDate: data.nextDueDate ? new Date(data.nextDueDate) : null,
          cost: data.cost ?? null,
          notes: data.notes,
          transactionId: txnId,
        },
      });
    });
    return NextResponse.json({ id: result.id });
  } catch (e) {
    return err(e);
  }
}
