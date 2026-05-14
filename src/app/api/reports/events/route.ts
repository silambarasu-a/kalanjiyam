import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[reports/events]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

/**
 * Cross-event spend report. Default window: last 12 months.
 * Returns each event with total spent, ordered by spend desc.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireWorkspace("events", "read");
    const { searchParams } = new URL(request.url);
    const monthsParam = Number(searchParams.get("months") ?? "12");
    const months = Number.isFinite(monthsParam) ? Math.max(1, Math.min(60, monthsParam)) : 12;

    const since = new Date();
    since.setUTCMonth(since.getUTCMonth() - months);

    const events = await prisma.event.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        startedAt: { gte: since },
      },
      orderBy: { startedAt: "desc" },
    });
    const ids = events.map((e) => e.id);
    const sums = ids.length
      ? await prisma.transaction.groupBy({
          by: ["eventId"],
          where: {
            workspaceId: ctx.workspaceId,
            eventId: { in: ids },
            type: "EXPENSE",
            transferId: null,
          },
          _sum: { amount: true },
        })
      : [];
    const sumsByEvent = new Map(
      sums.map((s) => [s.eventId as string, Number(s._sum.amount ?? 0)]),
    );

    const rows = events
      .map((e) => ({
        id: e.id,
        name: e.name,
        kind: e.kind,
        startedAt: e.startedAt.toISOString(),
        endedAt: e.endedAt?.toISOString() ?? null,
        budget: e.budget == null ? null : Number(e.budget),
        active: e.active,
        totalSpent: sumsByEvent.get(e.id) ?? 0,
      }))
      .sort((a, b) => b.totalSpent - a.totalSpent);

    return NextResponse.json({
      windowMonths: months,
      since: since.toISOString(),
      events: rows,
      grandTotal: rows.reduce((s, r) => s + r.totalSpent, 0),
    });
  } catch (e) {
    return err(e);
  }
}
