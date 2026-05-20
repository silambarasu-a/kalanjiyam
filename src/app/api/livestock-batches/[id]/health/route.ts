import { NextResponse } from "next/server";
import { TransactionKind, TransactionType } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { canAccessRecord } from "@/lib/permissions";
import { healthLogCreateSchema } from "@/lib/validators-domain";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[health]", e);
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
    const rows = await prisma.healthLog.findMany({
      where: { batchId: id },
      orderBy: { date: "desc" },
    });
    return NextResponse.json({
      healthLogs: rows.map((h) => ({
        id: h.id,
        animalId: h.animalId,
        date: h.date.toISOString(),
        condition: h.condition,
        treatment: h.treatment,
        cost: h.cost == null ? null : Number(h.cost),
        resolved: h.resolved,
        resolvedAt: h.resolvedAt?.toISOString() ?? null,
        transactionId: h.transactionId,
        notes: h.notes,
      })),
    });
  } catch (e) {
    return err(e);
  }
}

/**
 * Log a health / disease incident. Cost field is optional — when set
 * with a source, the API creates a linked EXPENSE Transaction
 * (kind=HEALTH_CARE) tagged to the batch.
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
    const parsed = healthLogCreateSchema.safeParse(body);
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

    const hasCost = (d.cost ?? 0) > 0;
    let resolvedAccountId: string | null = d.accountId ?? null;
    if (hasCost && d.cardId) {
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
    if (hasCost && resolvedAccountId) {
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
    if (hasCost && !resolvedAccountId && !d.cardId) {
      return NextResponse.json(
        { error: "Pick an account / card for the health expense" },
        { status: 400 },
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      let transactionId: string | null = null;
      if (hasCost) {
        const txn = await tx.transaction.create({
          data: {
            workspaceId: ctx.workspaceId,
            type: TransactionType.EXPENSE,
            kind: TransactionKind.HEALTH_CARE,
            amount: d.cost!,
            description:
              d.notes?.trim() ||
              `${d.condition}${d.treatment ? ` · ${d.treatment}` : ""}`,
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
      const row = await tx.healthLog.create({
        data: {
          batchId: id,
          animalId: d.animalId ?? null,
          date: new Date(d.date),
          condition: d.condition,
          treatment: d.treatment ?? null,
          cost: d.cost ?? null,
          resolved: d.resolved,
          resolvedAt: d.resolvedAt ? new Date(d.resolvedAt) : null,
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
