import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { workerUpdateSchema } from "@/lib/validators-domain";
import { computeWorkerBalance } from "@/lib/worker-balance";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireWorkspace("workers", "read");
    const { id } = await context.params;
    const worker = await prisma.worker.findUnique({ where: { id } });
    if (!worker || worker.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const [balance, attendance, payments, repayments, settlements] = await Promise.all([
      computeWorkerBalance(id),
      prisma.attendance.findMany({
        where: { workerId: id },
        orderBy: { date: "desc" },
        take: 60,
      }),
      prisma.wagePayment.findMany({
        where: { workerId: id },
        orderBy: { paidAt: "desc" },
        take: 30,
      }),
      prisma.advanceRepayment.findMany({
        where: { workerId: id },
        orderBy: { receivedAt: "desc" },
        take: 30,
      }),
      prisma.wageSettlement.findMany({
        where: { workerId: id },
        orderBy: { periodEnd: "desc" },
        take: 12,
      }),
    ]);
    return NextResponse.json({
      worker: {
        id: worker.id,
        name: worker.name,
        phone: worker.phone,
        dailyRate: worker.dailyRate == null ? null : Number(worker.dailyRate),
        settlementCadence: worker.settlementCadence,
        customCadenceDays: worker.customCadenceDays,
        active: worker.active,
        archivedAt: worker.archivedAt?.toISOString() ?? null,
      },
      balance,
      attendance: attendance.map((a) => ({
        id: a.id,
        date: a.date.toISOString(),
        present: a.present,
        dailyRateOverride: a.dailyRateOverride == null ? null : Number(a.dailyRateOverride),
        quantity: a.quantity == null ? null : Number(a.quantity),
        rate: a.rate == null ? null : Number(a.rate),
        cropBatchId: a.cropBatchId,
        livestockBatchId: a.livestockBatchId,
        notes: a.notes,
      })),
      payments: payments.map((p) => ({
        id: p.id,
        amount: Number(p.amount),
        paidAt: p.paidAt.toISOString(),
        isBonus: p.isBonus,
        isAdvance: p.isAdvance,
        notes: p.notes,
        transactionId: p.transactionId,
      })),
      repayments: repayments.map((r) => ({
        id: r.id,
        amount: Number(r.amount),
        receivedAt: r.receivedAt.toISOString(),
        notes: r.notes,
        transactionId: r.transactionId,
        reversedAt: r.reversedAt?.toISOString() ?? null,
        reversalReason: r.reversalReason,
      })),
      settlements: settlements.map((s) => ({
        id: s.id,
        periodStart: s.periodStart.toISOString(),
        periodEnd: s.periodEnd.toISOString(),
        cadence: s.cadence,
        earnedAmount: Number(s.earnedAmount),
        paidAmount: Number(s.paidAmount),
        amountDue: Number(s.amountDue),
        status: s.status,
        settledAt: s.settledAt?.toISOString() ?? null,
      })),
    });
  } catch (e) {
    return err(e);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireWorkspace("workers", "write");
    const { id } = await context.params;
    const existing = await prisma.worker.findUnique({ where: { id } });
    if (!existing || existing.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const body = await request.json();
    const parsed = workerUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const worker = await prisma.worker.update({
      where: { id },
      data: {
        name: parsed.data.name ?? existing.name,
        phone: parsed.data.phone ?? existing.phone,
        dailyRate: parsed.data.dailyRate ?? existing.dailyRate,
        settlementCadence: parsed.data.settlementCadence ?? existing.settlementCadence,
        customCadenceDays: parsed.data.customCadenceDays ?? existing.customCadenceDays,
        active: parsed.data.active ?? existing.active,
        archivedAt:
          parsed.data.archivedAt === undefined
            ? existing.archivedAt
            : parsed.data.archivedAt
              ? new Date(parsed.data.archivedAt)
              : null,
      },
    });
    return NextResponse.json({ id: worker.id });
  } catch (e) {
    return err(e);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireWorkspace("workers", "write");
    const { id } = await context.params;
    const existing = await prisma.worker.findUnique({ where: { id } });
    if (!existing || existing.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const [attendance, payments] = await Promise.all([
      prisma.attendance.count({ where: { workerId: id } }),
      prisma.wagePayment.count({ where: { workerId: id } }),
    ]);
    if (attendance > 0 || payments > 0) {
      return NextResponse.json(
        { error: "Worker has history — archive instead of deleting." },
        { status: 400 }
      );
    }
    await prisma.worker.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}
