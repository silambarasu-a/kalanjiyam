import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { canAccessRecord, visibilityFilter } from "@/lib/permissions";
import { transactionCreateSchema } from "@/lib/validators-domain";
import {
  TransactionType,
  MemberChargeType,
  MemberChargeStatus,
} from "@/generated/prisma/client";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[transactions]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const ctx = await requireWorkspace("transactions", "read");
    const session = await auth();
    const url = new URL(request.url);
    const type = url.searchParams.get("type");
    const accountId = url.searchParams.get("accountId");
    const cardId = url.searchParams.get("cardId");
    const beneficiaryMemberId = url.searchParams.get("beneficiaryMemberId");
    const limitParam = Number(url.searchParams.get("limit") ?? "50");
    const limit = Math.min(Math.max(limitParam, 1), 200);

    const where: Record<string, unknown> = { workspaceId: ctx.workspaceId };
    if (type) where.type = type;
    if (accountId) where.accountId = accountId;
    if (cardId) where.cardId = cardId;
    if (beneficiaryMemberId) where.beneficiaryMemberId = beneficiaryMemberId;

    if (ctx.ownOnly) {
      const ownAccountIds = await prisma.account
        .findMany({
          where: {
            workspaceId: ctx.workspaceId,
            ...visibilityFilter(session, true),
          },
          select: { id: true },
        })
        .then((r) => r.map((a) => a.id));
      where.OR = [{ userId: ctx.userId }, { accountId: { in: ownAccountIds } }];
    }

    const transactions = await prisma.transaction.findMany({
      where,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: limit,
      include: {
        category: { select: { id: true, name: true, group: true } },
        account: { select: { id: true, name: true, kind: true } },
        card: { select: { id: true, name: true } },
        beneficiaryMember: { select: { id: true, name: true } },
        memberCharge: { select: { id: true, status: true } },
      },
    });

    return NextResponse.json({
      transactions: transactions.map((t) => ({
        id: t.id,
        type: t.type,
        amount: Number(t.amount),
        description: t.description,
        date: t.date.toISOString(),
        category: t.category,
        account: t.account,
        card: t.card,
        beneficiary: t.beneficiaryMember,
        memberChargeType: t.memberChargeType,
        memberCharge: t.memberCharge,
        transferId: t.transferId,
      })),
    });
  } catch (e) {
    return err(e);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireWorkspace("transactions", "write");
    const session = await auth();
    const body = await request.json();
    const parsed = transactionCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const data = parsed.data;

    // Resolve account vs card. If a card is selected for payment, route the
    // transaction through the card's companion account so balance math works.
    let resolvedAccountId: string | null = data.accountId ?? null;
    const resolvedCardId: string | null = data.cardId ?? null;
    if (resolvedCardId) {
      const card = await prisma.card.findUnique({
        where: { id: resolvedCardId },
        select: { id: true, workspaceId: true, accountId: true, ownerUserId: true, sharedWithUserIds: true },
      });
      if (!card || card.workspaceId !== ctx.workspaceId) {
        return NextResponse.json({ error: "Card not found" }, { status: 404 });
      }
      if (!canAccessRecord(session, card)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      resolvedAccountId = card.accountId ?? resolvedAccountId;
    }
    if (resolvedAccountId) {
      const account = await prisma.account.findUnique({
        where: { id: resolvedAccountId },
        select: { id: true, workspaceId: true, ownerUserId: true, sharedWithUserIds: true },
      });
      if (!account || account.workspaceId !== ctx.workspaceId) {
        return NextResponse.json({ error: "Account not found" }, { status: 404 });
      }
      if (!canAccessRecord(session, account)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    if (data.beneficiaryMemberId) {
      const fm = await prisma.familyMember.findUnique({
        where: { id: data.beneficiaryMemberId },
        select: { workspaceId: true },
      });
      if (!fm || fm.workspaceId !== ctx.workspaceId) {
        return NextResponse.json({ error: "Family member not found" }, { status: 404 });
      }
    }

    const txDate = new Date(data.date);
    const charge =
      data.memberChargeType === "RECOVERABLE" && data.beneficiaryMemberId
        ? { create: true }
        : null;

    const created = await prisma.$transaction(async (tx) => {
      let memberChargeId: string | null = null;
      if (charge) {
        const mc = await tx.memberCharge.create({
          data: {
            workspaceId: ctx.workspaceId,
            beneficiaryMemberId: data.beneficiaryMemberId!,
            amount: data.amount,
            status: MemberChargeStatus.OUTSTANDING,
          },
        });
        memberChargeId = mc.id;
      }
      const txn = await tx.transaction.create({
        data: {
          workspaceId: ctx.workspaceId,
          type: data.type as TransactionType,
          amount: data.amount,
          description: data.description,
          date: txDate,
          categoryId: data.categoryId ?? null,
          accountId: resolvedAccountId,
          cardId: resolvedCardId,
          workerId: data.workerId ?? null,
          cropBatchId: data.cropBatchId ?? null,
          livestockBatchId: data.livestockBatchId ?? null,
          loanId: data.loanId ?? null,
          beneficiaryMemberId: data.beneficiaryMemberId ?? null,
          memberChargeType: (data.memberChargeType as MemberChargeType) ?? "NONE",
          memberChargeId,
          userId: ctx.userId,
          createdByUserId: ctx.userId,
        },
      });
      if (memberChargeId) {
        await tx.memberCharge.update({
          where: { id: memberChargeId },
          data: { originTransaction: { connect: { id: txn.id } } },
        });
      }
      return txn;
    });

    return NextResponse.json({ id: created.id });
  } catch (e) {
    return err(e);
  }
}
