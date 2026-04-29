import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { TransactionType, TransactionKind } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { canAccessRecord } from "@/lib/permissions";
import { auth } from "@/lib/auth";
import { advanceRepaymentCreateSchema } from "@/lib/validators-domain";
import { computeWorkerBalance } from "@/lib/worker-balance";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[advance-repayments]", e);
  return NextResponse.json(
    { code: "INTERNAL", error: "Something went wrong" },
    { status: 500 }
  );
}

export async function GET(request: Request) {
  try {
    const ctx = await requireWorkspace("wages", "read");
    const url = new URL(request.url);
    const workerId = url.searchParams.get("workerId");
    const repayments = await prisma.advanceRepayment.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        ...(workerId ? { workerId } : {}),
      },
      orderBy: { receivedAt: "desc" },
      take: 100,
      include: {
        worker: { select: { id: true, name: true } },
        receivedByUser: { select: { id: true, name: true } },
      },
    });
    return NextResponse.json({
      repayments: repayments.map((r) => ({
        id: r.id,
        workerId: r.workerId,
        amount: Number(r.amount),
        receivedAt: r.receivedAt.toISOString(),
        notes: r.notes,
        transactionId: r.transactionId,
        reversedAt: r.reversedAt?.toISOString() ?? null,
        reversalReason: r.reversalReason,
        worker: r.worker,
        receivedByUser: r.receivedByUser,
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
    const headerKey = request.headers.get("idempotency-key") ?? undefined;
    const parsed = advanceRepaymentCreateSchema.safeParse({
      ...body,
      idempotencyKey: body.idempotencyKey ?? headerKey,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { code: "VALIDATION", error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }
    const data = parsed.data;

    const worker = await prisma.worker.findUnique({ where: { id: data.workerId } });
    if (!worker || worker.workspaceId !== ctx.workspaceId) {
      return NextResponse.json(
        { code: "NOT_FOUND", error: "Worker not found" },
        { status: 404 }
      );
    }
    if (worker.archivedAt) {
      return NextResponse.json(
        { code: "WORKER_ARCHIVED", error: "Worker is archived" },
        { status: 400 }
      );
    }

    let resolvedAccountId: string | null = data.accountId ?? null;
    if (data.cardId) {
      const card = await prisma.card.findUnique({ where: { id: data.cardId } });
      if (!card || card.workspaceId !== ctx.workspaceId) {
        return NextResponse.json(
          { code: "NOT_FOUND", error: "Card not found" },
          { status: 404 }
        );
      }
      if (!canAccessRecord(session, card)) {
        return NextResponse.json(
          { code: "FORBIDDEN", error: "Forbidden" },
          { status: 403 }
        );
      }
      resolvedAccountId = card.accountId ?? resolvedAccountId;
    }
    if (!resolvedAccountId) {
      return NextResponse.json(
        { code: "VALIDATION", error: "Pick an account or a card" },
        { status: 400 }
      );
    }
    if (data.accountId) {
      const account = await prisma.account.findUnique({ where: { id: data.accountId } });
      if (!account || account.workspaceId !== ctx.workspaceId) {
        return NextResponse.json(
          { code: "NOT_FOUND", error: "Account not found" },
          { status: 404 }
        );
      }
      if (!canAccessRecord(session, account)) {
        return NextResponse.json(
          { code: "FORBIDDEN", error: "Forbidden" },
          { status: 403 }
        );
      }
    }

    const receivedAt = new Date(data.receivedAt);

    // Reject if a SETTLED settlement covers this date — the books for that
    // period were already closed; force the user to reverse and re-settle.
    const blockingSettlement = await prisma.wageSettlement.findFirst({
      where: {
        workerId: data.workerId,
        status: "SETTLED",
        periodStart: { lte: receivedAt },
        periodEnd: { gte: receivedAt },
      },
      select: { id: true, periodStart: true, periodEnd: true },
    });
    if (blockingSettlement) {
      return NextResponse.json(
        {
          code: "PERIOD_LOCKED",
          error: "A settled wage period covers this date — reverse the settlement first.",
        },
        { status: 409 }
      );
    }

    // Idempotency short-circuit: same (workerId, key) → return existing.
    if (data.idempotencyKey) {
      const existing = await prisma.advanceRepayment.findUnique({
        where: {
          workerId_idempotencyKey: {
            workerId: data.workerId,
            idempotencyKey: data.idempotencyKey,
          },
        },
      });
      if (existing) {
        const balance = await computeWorkerBalance(data.workerId);
        return NextResponse.json(
          {
            id: existing.id,
            transactionId: existing.transactionId,
            balanceAfter: balance,
            idempotent: true,
          },
          { status: 200 }
        );
      }
    }

    const result = await runWithRetry(async () =>
      prisma.$transaction(
        async (tx) => {
          // Lock the worker row for the duration of the txn.
          await tx.$queryRaw`SELECT id FROM "Worker" WHERE id = ${worker.id} FOR UPDATE`;

          // Outstanding advance under the lock.
          const [advanceAgg, repaidAgg] = await Promise.all([
            tx.wagePayment.aggregate({
              where: { workerId: worker.id, isAdvance: true, isBonus: false },
              _sum: { amount: true },
            }),
            tx.advanceRepayment.aggregate({
              where: { workerId: worker.id, reversedAt: null },
              _sum: { amount: true },
            }),
          ]);
          const advanced = Number(advanceAgg._sum.amount ?? 0);
          const repaid = Number(repaidAgg._sum.amount ?? 0);
          const outstanding = round2(advanced - repaid);
          if (data.amount > outstanding + 0.005) {
            throw new BusinessRuleError(
              "OVER_REPAYMENT",
              `Repayment exceeds outstanding advance (${outstanding.toFixed(2)})`,
              { outstanding }
            );
          }

          // Contra-expense ledger entry: same kind as the original advance,
          // negative amount so account balance + wage rollups net cleanly.
          const txn = await tx.transaction.create({
            data: {
              workspaceId: ctx.workspaceId,
              type: TransactionType.EXPENSE,
              kind: TransactionKind.WAGE,
              amount: new Prisma.Decimal(-data.amount),
              description: `Advance return · ${worker.name}${data.notes ? ` · ${data.notes}` : ""}`,
              date: receivedAt,
              accountId: resolvedAccountId,
              cardId: data.cardId ?? null,
              workerId: worker.id,
              userId: ctx.userId,
              createdByUserId: ctx.userId,
            },
          });

          const repayment = await tx.advanceRepayment.create({
            data: {
              workspaceId: ctx.workspaceId,
              workerId: worker.id,
              amount: data.amount,
              receivedAt,
              receivedByUserId: ctx.userId,
              notes: data.notes,
              idempotencyKey: data.idempotencyKey,
              transactionId: txn.id,
            },
          });

          await tx.auditLog.create({
            data: {
              workspaceId: ctx.workspaceId,
              userId: ctx.userId,
              action: "create",
              entityType: "AdvanceRepayment",
              entityId: repayment.id,
              diff: {
                after: {
                  workerId: worker.id,
                  amount: data.amount,
                  receivedAt: receivedAt.toISOString(),
                  accountId: resolvedAccountId,
                  cardId: data.cardId ?? null,
                  transactionId: txn.id,
                },
                outstandingBefore: outstanding,
                outstandingAfter: round2(outstanding - data.amount),
              },
            },
          });

          return { repayment, txnId: txn.id };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      )
    );

    const balance = await computeWorkerBalance(worker.id);
    return NextResponse.json({
      id: result.repayment.id,
      transactionId: result.txnId,
      balanceAfter: balance,
    });
  } catch (e) {
    if (e instanceof BusinessRuleError) {
      return NextResponse.json(
        { code: e.code, error: e.message, details: e.details },
        { status: 400 }
      );
    }
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002" &&
      Array.isArray(e.meta?.target) &&
      (e.meta.target as string[]).includes("idempotencyKey")
    ) {
      return NextResponse.json(
        { code: "IDEMPOTENT_DUPLICATE", error: "Duplicate request" },
        { status: 409 }
      );
    }
    return err(e);
  }
}

class BusinessRuleError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "BusinessRuleError";
  }
}

async function runWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      // P2034: serialization failure — safe to retry up to 2x.
      if (
        attempt < 2 &&
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2034"
      ) {
        continue;
      }
      throw e;
    }
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
