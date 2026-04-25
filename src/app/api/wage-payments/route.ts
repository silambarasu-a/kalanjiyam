import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { canAccessRecord } from "@/lib/permissions";
import { wagePaymentCreateSchema } from "@/lib/validators-domain";
import { TransactionType, TransactionKind } from "@/generated/prisma/client";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[wage-payments]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const ctx = await requireWorkspace("wages", "read");
    const url = new URL(request.url);
    const workerId = url.searchParams.get("workerId");
    const month = url.searchParams.get("month");
    let dateFilter: { gte: Date; lt: Date } | undefined;
    if (month) {
      if (!/^\d{4}-\d{2}$/.test(month)) {
        return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });
      }
      const [y, m] = month.split("-").map(Number);
      dateFilter = {
        gte: new Date(Date.UTC(y, m - 1, 1)),
        lt: new Date(Date.UTC(y, m, 1)),
      };
    }
    const payments = await prisma.wagePayment.findMany({
      where: {
        worker: { workspaceId: ctx.workspaceId },
        ...(workerId ? { workerId } : {}),
        ...(dateFilter ? { paidAt: dateFilter } : {}),
      },
      orderBy: { paidAt: "desc" },
      take: 100,
      include: {
        worker: { select: { id: true, name: true } },
        paidByUser: { select: { id: true, name: true } },
      },
    });
    return NextResponse.json({
      payments: payments.map((p) => ({
        id: p.id,
        workerId: p.workerId,
        amount: Number(p.amount),
        paidAt: p.paidAt.toISOString(),
        isBonus: p.isBonus,
        isAdvance: p.isAdvance,
        notes: p.notes,
        worker: p.worker,
        paidByUser: p.paidByUser,
        transactionId: p.transactionId,
      })),
    });
  } catch (e) {
    return err(e);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireWorkspace("wages", "write");
    const session = await auth();
    const body = await request.json();
    const parsed = wagePaymentCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const data = parsed.data;
    const worker = await prisma.worker.findUnique({ where: { id: data.workerId } });
    if (!worker || worker.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Worker not found" }, { status: 404 });
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

    const payment = await prisma.$transaction(async (tx) => {
      const txn = await tx.transaction.create({
        data: {
          workspaceId: ctx.workspaceId,
          type: TransactionType.EXPENSE,
          kind: TransactionKind.WAGE,
          amount: data.amount,
          description: `${data.isBonus ? "Bonus" : data.isAdvance ? "Advance" : "Wage"} · ${worker.name}${data.notes ? ` · ${data.notes}` : ""}`,
          date: new Date(data.paidAt),
          accountId: resolvedAccountId,
          cardId: data.cardId ?? null,
          workerId: data.workerId,
          userId: ctx.userId,
          createdByUserId: ctx.userId,
        },
      });
      return tx.wagePayment.create({
        data: {
          workerId: data.workerId,
          amount: data.amount,
          paidAt: new Date(data.paidAt),
          paidByUserId: ctx.userId,
          isBonus: data.isBonus ?? false,
          isAdvance: data.isAdvance ?? false,
          notes: data.notes,
          transactionId: txn.id,
        },
      });
    });
    return NextResponse.json({ id: payment.id });
  } catch (e) {
    return err(e);
  }
}
