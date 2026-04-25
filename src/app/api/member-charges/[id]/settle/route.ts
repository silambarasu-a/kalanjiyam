import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { canAccessRecord } from "@/lib/permissions";
import { memberChargeSettleSchema } from "@/lib/validators-domain";
import { MemberChargeStatus, TransactionType } from "@/generated/prisma/client";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[charge-settle]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireWorkspace("members", "write");
    const session = await auth();
    const { id } = await context.params;
    const body = await request.json();
    const parsed = memberChargeSettleSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const charge = await prisma.memberCharge.findUnique({ where: { id } });
    if (!charge || charge.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (charge.status === "SETTLED") {
      return NextResponse.json({ error: "Already settled" }, { status: 400 });
    }
    const remaining = Number(charge.amount) - Number(charge.settledAmount);
    const amount = parsed.data.amount;
    if (amount > remaining + 0.01) {
      return NextResponse.json(
        { error: `Settlement exceeds outstanding (₹${remaining.toFixed(2)})` },
        { status: 400 }
      );
    }
    const paidAt = new Date(parsed.data.paidAt);

    const accountForIncome: string | null = parsed.data.accountId ?? null;
    if (accountForIncome) {
      const acc = await prisma.account.findUnique({ where: { id: accountForIncome } });
      if (!acc || acc.workspaceId !== ctx.workspaceId) {
        return NextResponse.json({ error: "Account not found" }, { status: 404 });
      }
      if (!canAccessRecord(session, acc)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    const newSettled = Number(charge.settledAmount) + amount;
    const newStatus =
      newSettled >= Number(charge.amount) - 0.01
        ? MemberChargeStatus.SETTLED
        : MemberChargeStatus.PARTIAL;

    await prisma.$transaction(async (tx) => {
      let txnId: string | null = null;
      if (accountForIncome) {
        const txn = await tx.transaction.create({
          data: {
            workspaceId: ctx.workspaceId,
            type: TransactionType.INCOME,
            amount,
            description: `Settlement: ${parsed.data.notes ?? "Member charge"}`,
            date: paidAt,
            accountId: accountForIncome,
            beneficiaryMemberId: charge.beneficiaryMemberId,
            userId: ctx.userId,
            createdByUserId: ctx.userId,
          },
        });
        txnId = txn.id;
      }
      await tx.memberChargeSettlement.create({
        data: {
          chargeId: charge.id,
          amount,
          paidAt,
          notes: parsed.data.notes,
          transactionId: txnId,
        },
      });
      await tx.memberCharge.update({
        where: { id: charge.id },
        data: { settledAmount: newSettled, status: newStatus, lastSettlementAt: paidAt },
      });
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}
