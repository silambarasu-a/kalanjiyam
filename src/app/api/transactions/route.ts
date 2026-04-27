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
    const beneficiaryContactId = url.searchParams.get("beneficiaryContactId");
    const limitParam = Number(url.searchParams.get("limit") ?? "50");
    const limit = Math.min(Math.max(limitParam, 1), 200);

    const where: Record<string, unknown> = { workspaceId: ctx.workspaceId };
    if (type) where.type = type;
    if (accountId) where.accountId = accountId;
    if (cardId) where.cardId = cardId;
    if (beneficiaryContactId) where.beneficiaryContactId = beneficiaryContactId;

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
        beneficiaryContact: { select: { id: true, name: true } },
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
        beneficiary: t.beneficiaryContact,
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

    if (data.beneficiaryContactId) {
      const fm = await prisma.contact.findUnique({
        where: { id: data.beneficiaryContactId },
        select: { workspaceId: true },
      });
      if (!fm || fm.workspaceId !== ctx.workspaceId) {
        return NextResponse.json({ error: "Contact not found" }, { status: 404 });
      }
    }

    let investmentForUpdate: {
      id: string;
      amount: number;
      quantity: number | null;
      currentValue: number | null;
    } | null = null;
    if (data.investmentId) {
      const inv = await prisma.investment.findUnique({
        where: { id: data.investmentId },
      });
      if (!inv || inv.workspaceId !== ctx.workspaceId) {
        return NextResponse.json({ error: "Investment not found" }, { status: 404 });
      }
      if (!canAccessRecord(session, inv)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      investmentForUpdate = {
        id: inv.id,
        amount: Number(inv.amount),
        quantity: inv.quantity == null ? null : Number(inv.quantity),
        currentValue: inv.currentValue == null ? null : Number(inv.currentValue),
      };
    }

    const txDate = new Date(data.date);
    const charge =
      data.memberChargeType === "RECOVERABLE" && data.beneficiaryContactId
        ? { create: true }
        : null;

    const created = await prisma.$transaction(async (tx) => {
      let memberChargeId: string | null = null;
      if (charge) {
        const mc = await tx.memberCharge.create({
          data: {
            workspaceId: ctx.workspaceId,
            beneficiaryContactId: data.beneficiaryContactId!,
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
          investmentId: data.investmentId ?? null,
          investmentAction: data.investmentAction ?? null,
          investmentQty: data.investmentQty ?? null,
          investmentPrice: data.investmentPrice ?? null,
          exchangeRate: data.exchangeRate ?? null,
          beneficiaryContactId: data.beneficiaryContactId ?? null,
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
      // Side effect: update the linked investment's amount + quantity.
      // BUY adds; SELL subtracts (clamped at 0). currentValue tracks the
      // last-known market value — we don't touch it here.
      if (investmentForUpdate && data.investmentAction) {
        const sign = data.investmentAction === "BUY" ? 1 : -1;
        const newAmount = Math.max(0, investmentForUpdate.amount + sign * data.amount);
        const qtyDelta = data.investmentQty ?? 0;
        const newQty =
          investmentForUpdate.quantity == null && qtyDelta === 0
            ? null
            : Math.max(0, (investmentForUpdate.quantity ?? 0) + sign * qtyDelta);
        await tx.investment.update({
          where: { id: investmentForUpdate.id },
          data: {
            amount: newAmount,
            quantity: newQty,
          },
        });
      }
      return txn;
    });

    return NextResponse.json({ id: created.id });
  } catch (e) {
    return err(e);
  }
}
