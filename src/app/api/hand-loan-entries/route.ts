import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { canAccessRecord } from "@/lib/permissions";
import { handLoanEntryCreateSchema } from "@/lib/validators-domain";
import {
  TransactionType,
  HandLoanDirection,
  HandLoanKind,
} from "@/generated/prisma/client";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[hand-loan-entries]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function POST(request: Request) {
  try {
    const ctx = await requireWorkspace("hand_loans", "write");
    const session = await auth();
    const body = await request.json();
    const parsed = handLoanEntryCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const data = parsed.data;
    const member = await prisma.handLoanMember.findUnique({ where: { id: data.memberId } });
    if (!member || member.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
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

    // Money out (GIVEN) = expense on your account. Money in (RECEIVED) = income.
    const type = data.direction === "GIVEN" ? TransactionType.EXPENSE : TransactionType.INCOME;

    const entry = await prisma.$transaction(async (tx) => {
      const txn = await tx.transaction.create({
        data: {
          workspaceId: ctx.workspaceId,
          type,
          amount: data.amount,
          description: `Hand loan ${data.direction.toLowerCase()} · ${member.name}${data.notes ? ` · ${data.notes}` : ""}`,
          date: new Date(data.date),
          accountId: resolvedAccountId,
          cardId: data.cardId ?? null,
          userId: ctx.userId,
          createdByUserId: ctx.userId,
        },
      });
      return tx.handLoanEntry.create({
        data: {
          memberId: data.memberId,
          kind: HandLoanKind.INFORMAL,
          direction: data.direction as HandLoanDirection,
          amount: data.amount,
          date: new Date(data.date),
          notes: data.notes,
          transactionId: txn.id,
          createdByUserId: ctx.userId,
        },
      });
    });

    return NextResponse.json({ id: entry.id });
  } catch (e) {
    return err(e);
  }
}
