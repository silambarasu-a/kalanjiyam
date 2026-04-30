import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { computeWorkerBalance } from "@/lib/worker-balance";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[reports/wages/worker]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

/**
 * Per-worker wage detail for a date window:
 *
 *   - Worker meta (name, daily rate, settlement cadence)
 *   - Computed balance (earned, paid, advances, repaid, balance)
 *   - Attendance log (each day with computed earnings)
 *   - Wage payments (regular / advance / bonus)
 *   - Advance repayments
 *   - Settlements that overlap the window
 *
 * All numbers respect the requested date range so the per-worker totals
 * match the parent /reports/wages summary line.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ workerId: string }> },
) {
  try {
    const ctx = await requireWorkspace("reports", "read");
    const { workerId } = await context.params;
    const url = new URL(request.url);
    const startStr = url.searchParams.get("start");
    const endStr = url.searchParams.get("end");
    if (!startStr || !endStr) {
      return NextResponse.json(
        { error: "start and end required" },
        { status: 400 },
      );
    }
    const rangeStart = new Date(`${startStr}T00:00:00Z`);
    const rangeEnd = new Date(`${endStr}T23:59:59Z`);

    const worker = await prisma.worker.findUnique({
      where: { id: workerId },
      select: {
        id: true,
        name: true,
        phone: true,
        dailyRate: true,
        settlementCadence: true,
        active: true,
        archivedAt: true,
        workspaceId: true,
      },
    });
    if (!worker || worker.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const defaultRate = worker.dailyRate ? Number(worker.dailyRate) : 0;

    const [balance, attendance, payments, repayments, settlements] =
      await Promise.all([
        computeWorkerBalance(worker.id, { start: rangeStart, end: rangeEnd }),
        prisma.attendance.findMany({
          where: {
            workerId: worker.id,
            date: { gte: rangeStart, lte: rangeEnd },
          },
          orderBy: { date: "desc" },
          include: {
            cropBatch: { select: { id: true, name: true, crop: { select: { name: true } } } },
            livestockBatch: {
              select: { id: true, name: true, livestock: { select: { name: true } } },
            },
          },
        }),
        prisma.wagePayment.findMany({
          where: {
            workerId: worker.id,
            paidAt: { gte: rangeStart, lte: rangeEnd },
          },
          orderBy: { paidAt: "desc" },
          include: { paidByUser: { select: { name: true } } },
        }),
        prisma.advanceRepayment.findMany({
          where: {
            workerId: worker.id,
            receivedAt: { gte: rangeStart, lte: rangeEnd },
          },
          orderBy: { receivedAt: "desc" },
          include: { receivedByUser: { select: { name: true } } },
        }),
        prisma.wageSettlement.findMany({
          where: {
            workerId: worker.id,
            // overlap with window:
            periodStart: { lte: rangeEnd },
            periodEnd: { gte: rangeStart },
          },
          orderBy: { periodEnd: "desc" },
        }),
      ]);

    const attendanceRows = attendance.map((a) => {
      const rate = a.rate != null ? Number(a.rate) : null;
      const qty = a.quantity != null ? Number(a.quantity) : null;
      const override =
        a.dailyRateOverride != null ? Number(a.dailyRateOverride) : null;
      let earned = 0;
      let mode = "Daily";
      if (rate != null && qty != null) {
        earned = rate * qty;
        mode = `Piece ${qty} × ₹${rate}`;
      } else if (override != null) {
        earned = override;
        mode = `₹${override}/day (override)`;
      } else if (a.present) {
        earned = defaultRate;
        mode = `₹${defaultRate}/day`;
      } else {
        mode = "Absent";
      }
      const tagged = a.cropBatch
        ? `${a.cropBatch.crop.name} · ${a.cropBatch.name}`
        : a.livestockBatch
          ? `${a.livestockBatch.livestock.name} · ${a.livestockBatch.name}`
          : "";
      return {
        id: a.id,
        date: a.date.toISOString(),
        present: a.present,
        mode,
        earned: Math.round(earned * 100) / 100,
        notes: a.notes ?? null,
        tagged,
      };
    });

    const paymentRows = payments.map((p) => ({
      id: p.id,
      paidAt: p.paidAt.toISOString(),
      amount: Number(p.amount),
      kind: p.isBonus ? "BONUS" : p.isAdvance ? "ADVANCE" : "WAGE",
      notes: p.notes ?? null,
      paidBy: p.paidByUser?.name ?? null,
    }));

    const repaymentRows = repayments.map((r) => ({
      id: r.id,
      receivedAt: r.receivedAt.toISOString(),
      amount: Number(r.amount),
      reversed: r.reversedAt != null,
      reason: r.reversalReason,
      notes: r.notes ?? null,
      receivedBy: r.receivedByUser?.name ?? null,
    }));

    const settlementRows = settlements.map((s) => ({
      id: s.id,
      periodStart: s.periodStart.toISOString(),
      periodEnd: s.periodEnd.toISOString(),
      cadence: s.cadence,
      earnedAmount: Number(s.earnedAmount),
      paidAmount: Number(s.paidAmount),
      amountDue: Number(s.amountDue),
      status: s.status,
      settledAt: s.settledAt?.toISOString() ?? null,
    }));

    return NextResponse.json({
      worker: {
        id: worker.id,
        name: worker.name,
        phone: worker.phone,
        dailyRate: worker.dailyRate == null ? null : Number(worker.dailyRate),
        settlementCadence: worker.settlementCadence,
        active: worker.active && !worker.archivedAt,
      },
      rangeStart: rangeStart.toISOString(),
      rangeEnd: rangeEnd.toISOString(),
      balance,
      attendance: attendanceRows,
      payments: paymentRows,
      repayments: repaymentRows,
      settlements: settlementRows,
    });
  } catch (e) {
    return err(e);
  }
}
