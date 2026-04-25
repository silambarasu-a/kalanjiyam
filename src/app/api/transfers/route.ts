import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { canAccessRecord, visibilityFilter } from "@/lib/permissions";
import { transferCreateSchema } from "@/lib/validators-domain";
import { TransactionType } from "@/generated/prisma/client";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[transfers]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function GET() {
  try {
    const ctx = await requireWorkspace("transfers", "read");
    const session = await auth();

    const where: Record<string, unknown> = { workspaceId: ctx.workspaceId };
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
      where.OR = [
        { userId: ctx.userId },
        { fromAccountId: { in: ownAccountIds } },
        { toAccountId: { in: ownAccountIds } },
      ];
    }

    const transfers = await prisma.transfer.findMany({
      where,
      orderBy: { date: "desc" },
      take: 100,
      include: {
        fromAccount: { select: { id: true, name: true, kind: true } },
        toAccount: { select: { id: true, name: true, kind: true } },
      },
    });

    return NextResponse.json({
      transfers: transfers.map((t) => ({
        id: t.id,
        amount: Number(t.amount),
        date: t.date.toISOString(),
        notes: t.notes,
        from: t.fromAccount,
        to: t.toAccount,
      })),
    });
  } catch (e) {
    return err(e);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireWorkspace("transfers", "write");
    const session = await auth();
    const body = await request.json();
    const parsed = transferCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const [from, to] = await Promise.all([
      prisma.account.findUnique({ where: { id: parsed.data.fromAccountId } }),
      prisma.account.findUnique({ where: { id: parsed.data.toAccountId } }),
    ]);
    if (
      !from ||
      from.workspaceId !== ctx.workspaceId ||
      !to ||
      to.workspaceId !== ctx.workspaceId
    ) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }
    if (!canAccessRecord(session, from) || !canAccessRecord(session, to)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const date = new Date(parsed.data.date);
    const transfer = await prisma.$transaction(async (tx) => {
      const t = await tx.transfer.create({
        data: {
          workspaceId: ctx.workspaceId,
          userId: ctx.userId,
          fromAccountId: from.id,
          toAccountId: to.id,
          amount: parsed.data.amount,
          date,
          notes: parsed.data.notes,
        },
      });
      // Two transaction legs that link via transferId.
      await tx.transaction.createMany({
        data: [
          {
            workspaceId: ctx.workspaceId,
            type: TransactionType.TRANSFER,
            amount: parsed.data.amount,
            description: parsed.data.notes ?? "Transfer out",
            date,
            accountId: from.id,
            userId: ctx.userId,
            createdByUserId: ctx.userId,
            transferId: t.id,
          },
          {
            workspaceId: ctx.workspaceId,
            type: TransactionType.TRANSFER,
            amount: parsed.data.amount,
            description: parsed.data.notes ?? "Transfer in",
            date,
            accountId: to.id,
            userId: ctx.userId,
            createdByUserId: ctx.userId,
            transferId: t.id,
          },
        ],
      });
      return t;
    });
    return NextResponse.json({ id: transfer.id });
  } catch (e) {
    return err(e);
  }
}
