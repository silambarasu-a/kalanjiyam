import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { canAccessRecord } from "@/lib/permissions";
import { loanPaymentSchema } from "@/lib/validators-domain";
import { TransactionType, TransactionKind } from "@/generated/prisma/client";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[loan/pay]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

function featureForSource(source: string) {
  return source === "BANK" ? "bank_loans" : source === "CARD_EMI" ? "card_emi" : "hand_loans";
}

/**
 * Post an EMI / principal payment against a loan. Creates an EXPENSE
 * transaction and decrements Loan.outstanding by the principal portion
 * (or full amount if the split isn't supplied).
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const loan = await prisma.loan.findUnique({ where: { id } });
    if (!loan) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const ctx = await requireWorkspace(featureForSource(loan.source), "write");
    const session = await auth();
    if (loan.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const body = await request.json();
    const parsed = loanPaymentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const data = parsed.data;

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

    // If principal/interest split is supplied, decrement outstanding by
    // principal only (interest + GST are pure expense). Otherwise, decrement
    // by the full amount.
    const principalDrop = data.principalPortion ?? data.amount;
    const newOutstanding = Math.max(0, Number(loan.outstanding) - principalDrop);

    await prisma.$transaction(async (tx) => {
      const txn = await tx.transaction.create({
        data: {
          workspaceId: ctx.workspaceId,
          type: TransactionType.EXPENSE,
          kind: TransactionKind.LOAN_PAYMENT,
          amount: data.amount,
          description: `Loan payment · ${loan.lender}${data.notes ? ` · ${data.notes}` : ""}`,
          date: new Date(data.paidAt),
          accountId: resolvedAccountId,
          cardId: data.cardId ?? null,
          loanId: id,
          userId: ctx.userId,
          createdByUserId: ctx.userId,
        },
      });
      await tx.loan.update({
        where: { id },
        data: {
          outstanding: newOutstanding,
          active: newOutstanding > 0 ? loan.active : false,
          foreclosedAt: newOutstanding === 0 && loan.active ? new Date() : loan.foreclosedAt,
        },
      });
      return txn;
    });

    return NextResponse.json({ ok: true, outstanding: newOutstanding });
  } catch (e) {
    return err(e);
  }
}
