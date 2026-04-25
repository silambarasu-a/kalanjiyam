import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { canAccessRecord } from "@/lib/permissions";
import { wageSettlementSettleSchema } from "@/lib/validators-domain";
import {
  WageSettlementStatus,
  TransactionType,
  TransactionKind,
} from "@/generated/prisma/client";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[wage-settlement/settle]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

/**
 * Mark a wage settlement SETTLED. If amountDue > 0 and the caller supplied a
 * paymentAccountId/paymentCardId, auto-create a wage payment (+ expense txn)
 * clearing the outstanding amount.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireWorkspace("wages", "write");
    const session = await auth();
    const { id } = await context.params;
    const body = await request.json();
    const parsed = wageSettlementSettleSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const settlement = await prisma.wageSettlement.findUnique({
      where: { id },
      include: { worker: { select: { id: true, name: true, workspaceId: true } } },
    });
    if (!settlement || settlement.worker.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (settlement.status === "SETTLED") {
      return NextResponse.json({ error: "Already settled" }, { status: 400 });
    }

    let resolvedAccountId: string | null = parsed.data.paymentAccountId ?? null;
    if (parsed.data.paymentCardId) {
      const card = await prisma.card.findUnique({ where: { id: parsed.data.paymentCardId } });
      if (!card || card.workspaceId !== ctx.workspaceId) {
        return NextResponse.json({ error: "Card not found" }, { status: 404 });
      }
      if (!canAccessRecord(session, card)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      resolvedAccountId = card.accountId ?? resolvedAccountId;
    }
    const due = Number(settlement.amountDue);

    await prisma.$transaction(async (tx) => {
      if (due > 0 && resolvedAccountId) {
        const txn = await tx.transaction.create({
          data: {
            workspaceId: ctx.workspaceId,
            type: TransactionType.EXPENSE,
            kind: TransactionKind.WAGE,
            amount: due,
            description: `Wage settlement · ${settlement.worker.name}${parsed.data.notes ? ` · ${parsed.data.notes}` : ""}`,
            date: new Date(),
            accountId: resolvedAccountId,
            cardId: parsed.data.paymentCardId ?? null,
            workerId: settlement.workerId,
            userId: ctx.userId,
            createdByUserId: ctx.userId,
          },
        });
        await tx.wagePayment.create({
          data: {
            workerId: settlement.workerId,
            amount: due,
            paidAt: new Date(),
            paidByUserId: ctx.userId,
            notes: parsed.data.notes,
            transactionId: txn.id,
          },
        });
      }
      await tx.wageSettlement.update({
        where: { id },
        data: {
          status: WageSettlementStatus.SETTLED,
          settledAt: new Date(),
          settledByUserId: ctx.userId,
          paidAmount:
            due > 0 && resolvedAccountId
              ? Number(settlement.paidAmount) + due
              : settlement.paidAmount,
          amountDue:
            due > 0 && resolvedAccountId ? 0 : settlement.amountDue,
        },
      });
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}
