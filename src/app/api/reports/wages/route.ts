import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { computeWorkerBalance } from "@/lib/worker-balance";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[reports/wages]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

/**
 * Per-worker wages report for a given window. Uses computeWorkerBalance for
 * each active worker, range-scoped, so numbers match the worker detail page.
 *
 * Returns one row per worker with days worked, earned, paid, advances out,
 * bonuses, and the running balance owed.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireWorkspace("reports", "read");
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

    const workers = await prisma.worker.findMany({
      where: { workspaceId: ctx.workspaceId },
      orderBy: [{ active: "desc" }, { name: "asc" }],
      select: { id: true, name: true, active: true, archivedAt: true, dailyRate: true },
    });

    const rows = await Promise.all(
      workers.map(async (w) => {
        const b = await computeWorkerBalance(w.id, {
          start: rangeStart,
          end: rangeEnd,
        });
        return {
          id: w.id,
          name: w.name,
          active: w.active && !w.archivedAt,
          dailyRate: w.dailyRate == null ? null : Number(w.dailyRate),
          daysWorked: b.daysWorked,
          earned: b.earned,
          paidFromWages: b.paidFromWages,
          advances: b.advances,
          repaid: b.repaid,
          bonuses: b.bonuses,
          balance: b.balance,
        };
      }),
    );

    const totals = rows.reduce(
      (acc, r) => ({
        daysWorked: acc.daysWorked + r.daysWorked,
        earned: acc.earned + r.earned,
        paidFromWages: acc.paidFromWages + r.paidFromWages,
        advances: acc.advances + r.advances,
        repaid: acc.repaid + r.repaid,
        bonuses: acc.bonuses + r.bonuses,
        balance: acc.balance + r.balance,
      }),
      {
        daysWorked: 0,
        earned: 0,
        paidFromWages: 0,
        advances: 0,
        repaid: 0,
        bonuses: 0,
        balance: 0,
      },
    );

    return NextResponse.json({
      rangeStart: rangeStart.toISOString(),
      rangeEnd: rangeEnd.toISOString(),
      rows,
      totals: roundTotals(totals),
    });
  } catch (e) {
    return err(e);
  }
}

function roundTotals<T extends Record<string, number>>(t: T): T {
  const out: Record<string, number> = {};
  for (const k of Object.keys(t)) {
    out[k] = Math.round(t[k] * 100) / 100;
  }
  return out as T;
}
