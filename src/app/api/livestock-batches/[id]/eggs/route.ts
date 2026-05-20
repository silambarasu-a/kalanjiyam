import { NextResponse } from "next/server";
import { Prisma, TransactionKind, TransactionType } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { canAccessRecord } from "@/lib/permissions";
import { eggLogCreateSchema } from "@/lib/validators-domain";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[eggs]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

async function loadBatch(id: string, workspaceId: string) {
  const batch = await prisma.livestockBatch.findUnique({
    where: { id },
    include: { livestock: { select: { workspaceId: true } } },
  });
  if (!batch || batch.livestock.workspaceId !== workspaceId) return null;
  return batch;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireWorkspace("livestock", "read");
    const { id } = await context.params;
    const batch = await loadBatch(id, ctx.workspaceId);
    if (!batch) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const rows = await prisma.eggProductionLog.findMany({
      where: { batchId: id },
      orderBy: { date: "desc" },
    });
    return NextResponse.json({
      eggLogs: rows.map((e) => ({
        id: e.id,
        date: e.date.toISOString(),
        collected: e.collected,
        grades: e.grades,
        broken: e.broken,
        sold: e.sold,
        salePricePerEgg:
          e.salePricePerEgg == null ? null : Number(e.salePricePerEgg),
        transactionId: e.transactionId,
        notes: e.notes,
      })),
    });
  } catch (e) {
    return err(e);
  }
}

/**
 * Daily egg collection log. Sale fields (`sold` + `salePricePerEgg`) are
 * optional — when both are present the API creates a linked INCOME
 * Transaction (kind=EGG_SALE) tagged to the batch. Production-only
 * logs (eggs collected but not yet sold) leave `transactionId` null.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireWorkspace("livestock", "write");
    const session = await auth();
    const { id } = await context.params;
    const body = await request.json();
    const parsed = eggLogCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const d = parsed.data;
    const batch = await loadBatch(id, ctx.workspaceId);
    if (!batch) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const hasSale = (d.sold ?? 0) > 0 && (d.salePricePerEgg ?? 0) > 0;
    let resolvedAccountId: string | null = d.accountId ?? null;
    if (hasSale && d.cardId) {
      const card = await prisma.card.findUnique({
        where: { id: d.cardId },
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
    }
    if (hasSale && resolvedAccountId) {
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
    if (hasSale && !resolvedAccountId && !d.cardId) {
      return NextResponse.json(
        { error: "Pick an account / card to receive the egg sale into" },
        { status: 400 },
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      let transactionId: string | null = null;
      if (hasSale) {
        const saleAmount = +((d.sold ?? 0) * (d.salePricePerEgg ?? 0)).toFixed(2);
        const txn = await tx.transaction.create({
          data: {
            workspaceId: ctx.workspaceId,
            type: TransactionType.INCOME,
            kind: TransactionKind.EGG_SALE,
            amount: saleAmount,
            description:
              d.notes?.trim() || `Egg sale · ${d.sold ?? 0} eggs`,
            date: new Date(d.date),
            accountId: resolvedAccountId,
            cardId: d.cardId ?? null,
            livestockBatchId: id,
            userId: ctx.userId,
            createdByUserId: ctx.userId,
          },
        });
        transactionId = txn.id;
      }
      const row = await tx.eggProductionLog.create({
        data: {
          batchId: id,
          date: new Date(d.date),
          collected: d.collected,
          grades:
            d.grades == null
              ? Prisma.JsonNull
              : (d.grades as Prisma.InputJsonValue),
          broken: d.broken ?? null,
          sold: d.sold ?? null,
          salePricePerEgg: d.salePricePerEgg ?? null,
          transactionId,
          notes: d.notes ?? null,
        },
      });
      return row.id;
    });
    return NextResponse.json({ id: result });
  } catch (e) {
    return err(e);
  }
}
