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
  Prisma,
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
        // Pull both sides of the transfer so we can label each leg as
        // OUT (this account funded the transfer) or IN (this account
        // received it). Without this the UI shows two identical-looking
        // rows for a self-transfer with no direction cue.
        transfer: {
          select: {
            fromAccountId: true,
            toAccountId: true,
            fromAccount: { select: { id: true, name: true, kind: true } },
            toAccount: { select: { id: true, name: true, kind: true } },
            fromContact: { select: { id: true, name: true } },
            toContact: { select: { id: true, name: true } },
          },
        },
      },
    });

    return NextResponse.json({
      transactions: transactions.map((t) => {
        let transferDirection: "OUT" | "IN" | null = null;
        let transferCounterparty: { name: string; kind: "ACCOUNT" | "CONTACT" } | null = null;
        if (t.transfer && t.accountId) {
          if (t.transfer.fromAccountId === t.accountId) {
            transferDirection = "OUT";
            // Counterparty = the OTHER side. Could be another account or a
            // contact, so check both.
            if (t.transfer.toAccount) {
              transferCounterparty = { name: t.transfer.toAccount.name, kind: "ACCOUNT" };
            } else if (t.transfer.toContact) {
              transferCounterparty = { name: t.transfer.toContact.name, kind: "CONTACT" };
            }
          } else if (t.transfer.toAccountId === t.accountId) {
            transferDirection = "IN";
            if (t.transfer.fromAccount) {
              transferCounterparty = { name: t.transfer.fromAccount.name, kind: "ACCOUNT" };
            } else if (t.transfer.fromContact) {
              transferCounterparty = { name: t.transfer.fromContact.name, kind: "CONTACT" };
            }
          }
        }
        return {
          id: t.id,
          type: t.type,
          kind: t.kind,
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
          transferDirection,
          transferCounterparty,
          refundForTransactionId: t.refundForTransactionId,
        };
      }),
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
    let resolvedCardKind: "DEBIT" | "CREDIT" | null = null;
    if (resolvedCardId) {
      const card = await prisma.card.findUnique({
        where: { id: resolvedCardId },
        select: {
          id: true,
          workspaceId: true,
          accountId: true,
          kind: true,
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
      resolvedCardKind = card.kind;
    }

    // Refund-specific validation. The Zod refine() only enforces shape; this
    // checks workspace + ownership + that the linked original is a refundable
    // expense on the same card.
    if (data.kind === "REFUND") {
      if (resolvedCardKind !== "CREDIT") {
        return NextResponse.json(
          { error: "Refunds can only be posted to a credit card" },
          { status: 400 },
        );
      }
      if (data.refundForTransactionId) {
        const original = await prisma.transaction.findUnique({
          where: { id: data.refundForTransactionId },
          select: {
            workspaceId: true,
            type: true,
            cardId: true,
            amount: true,
          },
        });
        if (!original || original.workspaceId !== ctx.workspaceId) {
          return NextResponse.json(
            { error: "Original transaction not found" },
            { status: 404 },
          );
        }
        if (original.type !== "EXPENSE") {
          return NextResponse.json(
            { error: "A refund must reverse an expense" },
            { status: 400 },
          );
        }
        if (original.cardId !== resolvedCardId) {
          return NextResponse.json(
            { error: "Refund must be on the same card as the original purchase" },
            { status: 400 },
          );
        }
      }
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
      purchasePrice: number | null;
      purchaseExchangeRate: number | null;
      currency: string | null;
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
        purchasePrice: inv.purchasePrice == null ? null : Number(inv.purchasePrice),
        purchaseExchangeRate:
          inv.purchaseExchangeRate == null ? null : Number(inv.purchaseExchangeRate),
        currency: inv.currency,
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
          kind: data.kind ?? null,
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
          refundForTransactionId: data.refundForTransactionId ?? null,
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
      // Side effect: update the linked investment's summary fields.
      // BUY adds; SELL subtracts (clamped at 0). currentValue tracks the
      // last-known market value — we don't touch it here.
      // On BUY we also recompute weighted-average purchasePrice (in native
      // currency) and, for USD holdings, weighted-average
      // purchaseExchangeRate. SELL leaves cost basis of remaining shares
      // unchanged (standard accounting convention — proceeds realize gains
      // against the existing avg cost).
      if (investmentForUpdate && data.investmentAction) {
        const sign = data.investmentAction === "BUY" ? 1 : -1;
        const newAmount = Math.max(0, investmentForUpdate.amount + sign * data.amount);
        const qtyDelta = data.investmentQty ?? 0;
        const oldQty = investmentForUpdate.quantity ?? 0;
        const newQty =
          investmentForUpdate.quantity == null && qtyDelta === 0
            ? null
            : Math.max(0, oldQty + sign * qtyDelta);

        const updateData: Prisma.InvestmentUpdateInput = {
          amount: newAmount,
          quantity: newQty,
        };

        if (
          sign === 1 &&
          qtyDelta > 0 &&
          data.investmentPrice != null &&
          newQty != null &&
          newQty > 0
        ) {
          const oldPP = investmentForUpdate.purchasePrice ?? 0;
          const tradePrice = data.investmentPrice;
          const newPP =
            oldQty > 0 && oldPP > 0
              ? (oldQty * oldPP + qtyDelta * tradePrice) / newQty
              : tradePrice;
          updateData.purchasePrice = newPP;

          if (
            investmentForUpdate.currency === "USD" &&
            newAmount > 0 &&
            newPP > 0
          ) {
            // Derived from the cost identity: amount = qty × pp × rate.
            updateData.purchaseExchangeRate = newAmount / (newQty * newPP);
          }
        }

        await tx.investment.update({
          where: { id: investmentForUpdate.id },
          data: updateData,
        });
      }
      return txn;
    });

    return NextResponse.json({ id: created.id });
  } catch (e) {
    return err(e);
  }
}
