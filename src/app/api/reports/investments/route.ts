import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[reports/investments]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

/**
 * Investment portfolio: every holding with cost basis, current value,
 * unrealised P&L, and dividends received. Splits by `kind`.
 */
export async function GET() {
  try {
    const ctx = await requireWorkspace("reports", "read");
    const investments = await prisma.investment.findMany({
      where: { workspaceId: ctx.workspaceId },
      orderBy: [{ active: "desc" }, { kind: "asc" }, { name: "asc" }],
    });

    const rows = investments.map((i) => {
      const cost = Number(i.amount);
      const current = i.currentValue == null ? cost : Number(i.currentValue);
      const dividends = i.dividends == null ? 0 : Number(i.dividends);
      const pnl = current + dividends - cost;
      const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
      return {
        id: i.id,
        name: i.name,
        kind: i.kind,
        institution: i.institution,
        symbol: i.symbol,
        cost: round2(cost),
        currentValue: round2(current),
        dividends: round2(dividends),
        pnl: round2(pnl),
        pnlPct: round2(pnlPct),
        startedAt: i.startedAt.toISOString(),
        maturityAt: i.maturityAt?.toISOString() ?? null,
        active: i.active,
        currency: i.currency ?? "INR",
      };
    });

    const totals = {
      cost: round2(rows.filter((r) => r.active).reduce((s, r) => s + r.cost, 0)),
      currentValue: round2(
        rows.filter((r) => r.active).reduce((s, r) => s + r.currentValue, 0),
      ),
      dividends: round2(rows.reduce((s, r) => s + r.dividends, 0)),
      pnl: 0,
      pnlPct: 0,
      activeCount: rows.filter((r) => r.active).length,
    };
    totals.pnl = round2(totals.currentValue + totals.dividends - totals.cost);
    totals.pnlPct = totals.cost > 0 ? round2((totals.pnl / totals.cost) * 100) : 0;

    return NextResponse.json({ rows, totals });
  } catch (e) {
    return err(e);
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
