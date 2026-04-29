import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { TransactionType, TransactionKind } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { advanceRepaymentReverseSchema } from "@/lib/validators-domain";
import { computeWorkerBalance } from "@/lib/worker-balance";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[advance-repayments.reverse]", e);
  return NextResponse.json(
    { code: "INTERNAL", error: "Something went wrong" },
    { status: 500 }
  );
}

// Ledger reversal — never deletes. Posts an offsetting Transaction so books
// stay append-only, and flags the repayment with reversedAt so the balance
// helper stops netting it.
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireWorkspace("wages", "write");
    if (ctx.role !== "OWNER" && ctx.role !== "ADMIN" && ctx.role !== "SUPER_ADMIN") {
      return NextResponse.json(
        { code: "FORBIDDEN", error: "Reversing a repayment requires admin." },
        { status: 403 }
      );
    }
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const parsed = advanceRepaymentReverseSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { code: "VALIDATION", error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const existing = await prisma.advanceRepayment.findUnique({
      where: { id },
      include: { worker: { select: { id: true, name: true, workspaceId: true } } },
    });
    if (!existing || existing.workspaceId !== ctx.workspaceId) {
      return NextResponse.json(
        { code: "NOT_FOUND", error: "Not found" },
        { status: 404 }
      );
    }
    if (existing.reversedAt) {
      return NextResponse.json(
        { code: "ALREADY_REVERSED", error: "Already reversed" },
        { status: 409 }
      );
    }

    const original = existing;
    await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Worker" WHERE id = ${original.workerId} FOR UPDATE`;

        // Recheck under lock — guard against concurrent reverse calls.
        const fresh = await tx.advanceRepayment.findUnique({
          where: { id: original.id },
          select: { reversedAt: true },
        });
        if (fresh?.reversedAt) {
          throw new Prisma.PrismaClientKnownRequestError("Already reversed", {
            code: "P2034",
            clientVersion: "noop",
          });
        }

        const counterTxn = await tx.transaction.create({
          data: {
            workspaceId: ctx.workspaceId,
            type: TransactionType.EXPENSE,
            kind: TransactionKind.WAGE,
            amount: new Prisma.Decimal(original.amount),
            description: `Advance return reversed · ${original.worker.name}${parsed.data.reason ? ` · ${parsed.data.reason}` : ""}`,
            date: new Date(),
            workerId: original.workerId,
            userId: ctx.userId,
            createdByUserId: ctx.userId,
          },
        });

        await tx.advanceRepayment.update({
          where: { id: original.id },
          data: {
            reversedAt: new Date(),
            reversedByUserId: ctx.userId,
            reversalReason: parsed.data.reason,
          },
        });

        await tx.auditLog.create({
          data: {
            workspaceId: ctx.workspaceId,
            userId: ctx.userId,
            action: "reverse",
            entityType: "AdvanceRepayment",
            entityId: original.id,
            diff: {
              reason: parsed.data.reason,
              counterTransactionId: counterTxn.id,
              originalTransactionId: original.transactionId,
              amount: Number(original.amount),
            },
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    const balance = await computeWorkerBalance(original.workerId);
    return NextResponse.json({ ok: true, balanceAfter: balance });
  } catch (e) {
    return err(e);
  }
}
