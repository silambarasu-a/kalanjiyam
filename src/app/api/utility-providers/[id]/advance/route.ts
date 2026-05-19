import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { utilityAdvanceCreateSchema } from "@/lib/validators-domain";
import { canAccessRecord, canModifyRecord } from "@/lib/permissions";
import {
  TransactionKind,
  TransactionType,
} from "@/generated/prisma/client";
import { resolveUtilityCategoryId } from "@/lib/utility-category";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[utility-providers/[id]/advance]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

/**
 * Deposit cash into a provider's advance balance. Creates a Transaction
 * (kind=UTILITY_ADVANCE, EXPENSE) and increments provider.advanceBalance
 * atomically. Subsequent bills pull from this balance first.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireWorkspace("bills", "write");
    const session = await auth();
    const { id } = await context.params;
    const provider = await prisma.utilityProvider.findUnique({ where: { id } });
    if (!provider || provider.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!canModifyRecord(session, provider)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = await request.json();
    const parsed = utilityAdvanceCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const d = parsed.data;

    let resolvedAccountId: string | null = d.accountId ?? null;
    const resolvedCardId: string | null = d.cardId ?? null;
    if (resolvedCardId) {
      const card = await prisma.card.findUnique({
        where: { id: resolvedCardId },
        select: {
          workspaceId: true,
          accountId: true,
          ownerUserId: true,
          sharedWithUserIds: true,
        },
      });
      if (!card || card.workspaceId !== ctx.workspaceId) {
        return NextResponse.json({ error: "Card not found" }, { status: 404 });
      }
      if (!canAccessRecord(session, card)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      resolvedAccountId = card.accountId ?? resolvedAccountId;
    } else if (resolvedAccountId) {
      const acc = await prisma.account.findUnique({
        where: { id: resolvedAccountId },
        select: {
          workspaceId: true,
          ownerUserId: true,
          sharedWithUserIds: true,
        },
      });
      if (!acc || acc.workspaceId !== ctx.workspaceId) {
        return NextResponse.json({ error: "Account not found" }, { status: 404 });
      }
      if (!canAccessRecord(session, acc)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    const txDate = new Date(d.date);
    if (Number.isNaN(txDate.getTime())) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }

    // Same category mapping as bill payments so the user's cashflow /
    // PnL reports don't show advance deposits as "Uncategorized".
    const categoryId = await resolveUtilityCategoryId(
      ctx.workspaceId,
      provider.kind,
    );

    const result = await prisma.$transaction(async (tx) => {
      const txn = await tx.transaction.create({
        data: {
          workspaceId: ctx.workspaceId,
          type: TransactionType.EXPENSE,
          kind: TransactionKind.UTILITY_ADVANCE,
          amount: d.amount,
          description:
            d.notes?.trim() || `Advance to ${provider.providerName}`,
          date: txDate,
          categoryId,
          accountId: resolvedAccountId,
          cardId: resolvedCardId,
          utilityProviderId: provider.id,
          userId: ctx.userId,
          createdByUserId: ctx.userId,
        },
      });
      const updated = await tx.utilityProvider.update({
        where: { id: provider.id },
        data: { advanceBalance: { increment: d.amount } },
      });
      return { transactionId: txn.id, advanceBalance: Number(updated.advanceBalance) };
    });

    return NextResponse.json(result);
  } catch (e) {
    return err(e);
  }
}
