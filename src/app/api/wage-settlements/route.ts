import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { computeWorkerBalance } from "@/lib/worker-balance";
import { WageSettlementCadence, WageSettlementStatus } from "@/generated/prisma/client";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[wage-settlements]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const ctx = await requireWorkspace("wages", "read");
    const url = new URL(request.url);
    const workerId = url.searchParams.get("workerId");
    const status = url.searchParams.get("status");
    const settlements = await prisma.wageSettlement.findMany({
      where: {
        worker: { workspaceId: ctx.workspaceId },
        ...(workerId ? { workerId } : {}),
        ...(status ? { status: status as WageSettlementStatus } : {}),
      },
      orderBy: { periodEnd: "desc" },
      take: 100,
      include: { worker: { select: { id: true, name: true } } },
    });
    return NextResponse.json({
      settlements: settlements.map((s) => ({
        id: s.id,
        worker: s.worker,
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

/**
 * POST /api/wage-settlements/generate — scan active workers whose cadence
 * period just ended and create PENDING settlement rows snapshotting earnings,
 * payments, and amountDue for the window. Existing PENDING rows for the same
 * period are skipped.
 */
export async function POST() {
  try {
    const ctx = await requireWorkspace("wages", "write");
    const workers = await prisma.worker.findMany({
      where: { workspaceId: ctx.workspaceId, active: true },
    });
    const now = new Date();
    const created: string[] = [];

    for (const w of workers) {
      const window = computeCadenceWindow(
        w.settlementCadence,
        w.customCadenceDays ?? null,
        now
      );
      if (!window) continue;

      const existing = await prisma.wageSettlement.findFirst({
        where: {
          workerId: w.id,
          periodStart: window.start,
          periodEnd: window.end,
        },
      });
      if (existing) continue;

      const bal = await computeWorkerBalance(w.id, { start: window.start, end: window.end });
      if (bal.daysWorked === 0 && bal.paidFromWages === 0) continue;

      const settlement = await prisma.wageSettlement.create({
        data: {
          workerId: w.id,
          periodStart: window.start,
          periodEnd: window.end,
          cadence: w.settlementCadence as WageSettlementCadence,
          earnedAmount: bal.earned,
          paidAmount: bal.paidFromWages,
          amountDue: bal.balance,
          status: WageSettlementStatus.PENDING,
          snapshot: {
            daysWorked: bal.daysWorked,
            bonuses: bal.bonuses,
            advances: bal.advances,
            generatedAt: now.toISOString(),
          },
        },
      });
      created.push(settlement.id);
    }

    return NextResponse.json({ created: created.length, settlementIds: created });
  } catch (e) {
    return err(e);
  }
}

function computeCadenceWindow(
  cadence: WageSettlementCadence,
  customDays: number | null,
  now: Date
): { start: Date; end: Date } | null {
  if (cadence === "WEEKLY") {
    const end = startOfDay(now);
    end.setUTCDate(end.getUTCDate() - end.getUTCDay()); // last Sunday
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - 6);
    return { start, end };
  }
  if (cadence === "MONTHLY") {
    const end = startOfDay(now);
    end.setUTCDate(0); // last day of previous month at UTC 00:00
    const start = new Date(end);
    start.setUTCDate(1);
    return { start, end };
  }
  if (cadence === "CUSTOM" && customDays && customDays > 0) {
    const end = startOfDay(now);
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - customDays + 1);
    return { start, end };
  }
  return null;
}

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setUTCHours(0, 0, 0, 0);
  return c;
}
