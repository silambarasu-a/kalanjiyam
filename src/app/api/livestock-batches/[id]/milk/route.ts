import { NextResponse } from "next/server";
import { Prisma, TransactionKind, TransactionType } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { canAccessRecord } from "@/lib/permissions";
import { milkLogCreateSchema } from "@/lib/validators-domain";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[milk]", e);
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
    const rows = await prisma.milkLog.findMany({
      where: { batchId: id },
      orderBy: { date: "desc" },
    });
    return NextResponse.json({
      milkLogs: rows.map((m) => ({
        id: m.id,
        animalId: m.animalId,
        date: m.date.toISOString(),
        totalLitres: Number(m.totalLitres),
        sessions: m.sessions,
        fatPct: m.fatPct == null ? null : Number(m.fatPct),
        snfPct: m.snfPct == null ? null : Number(m.snfPct),
        soldLitres: m.soldLitres == null ? null : Number(m.soldLitres),
        ratePerLitre:
          m.ratePerLitre == null ? null : Number(m.ratePerLitre),
        transactionId: m.transactionId,
        notes: m.notes,
      })),
    });
  } catch (e) {
    return err(e);
  }
}

/**
 * Daily milk log. When `soldLitres` and `ratePerLitre` are both set,
 * we create a linked INCOME Transaction (kind=MILK_SALE) tagged to the
 * batch so the cashflow dashboard stays accurate. Production-only logs
 * (no sale) are valid — `transactionId` stays null.
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
    const parsed = milkLogCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const d = parsed.data;
    const batch = await loadBatch(id, ctx.workspaceId);
    if (!batch) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (d.animalId) {
      const animal = await prisma.livestockAnimal.findUnique({
        where: { id: d.animalId },
        select: { batchId: true },
      });
      if (!animal || animal.batchId !== id) {
        return NextResponse.json({ error: "Animal not found" }, { status: 404 });
      }
    }

    const hasSale = (d.soldLitres ?? 0) > 0 && (d.ratePerLitre ?? 0) > 0;
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
        { error: "Pick an account / card to receive the milk sale into" },
        { status: 400 },
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      let transactionId: string | null = null;
      if (hasSale) {
        const saleAmount = +((d.soldLitres ?? 0) * (d.ratePerLitre ?? 0)).toFixed(2);
        const txn = await tx.transaction.create({
          data: {
            workspaceId: ctx.workspaceId,
            type: TransactionType.INCOME,
            kind: TransactionKind.MILK_SALE,
            amount: saleAmount,
            description:
              d.notes?.trim() ||
              `Milk sale · ${d.soldLitres?.toFixed(1) ?? "0"} L`,
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
      const row = await tx.milkLog.create({
        data: {
          batchId: id,
          animalId: d.animalId ?? null,
          date: new Date(d.date),
          totalLitres: d.totalLitres,
          sessions:
            d.sessions == null
              ? Prisma.JsonNull
              : (d.sessions as Prisma.InputJsonValue),
          fatPct: d.fatPct ?? null,
          snfPct: d.snfPct ?? null,
          soldLitres: d.soldLitres ?? null,
          ratePerLitre: d.ratePerLitre ?? null,
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
