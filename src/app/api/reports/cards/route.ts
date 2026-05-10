import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[reports/cards]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

/**
 * Per-card spend within a window plus credit-card outstanding (current
 * statement balance) for credit-kind cards.
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

    const cards = await prisma.card.findMany({
      where: { workspaceId: ctx.workspaceId, active: true },
      select: {
        id: true,
        name: true,
        kind: true,
        network: true,
        last4: true,
        accountId: true,
        account: { select: { creditLimit: true } },
      },
    });

    const ids = cards.map((c) => c.id);
    if (ids.length === 0) {
      return NextResponse.json({
        rangeStart: rangeStart.toISOString(),
        rangeEnd: rangeEnd.toISOString(),
        rows: [],
        totals: { spend: 0, txns: 0 },
      });
    }

    const spendAgg = await prisma.transaction.groupBy({
      by: ["cardId"],
      where: {
        cardId: { in: ids },
        transferId: null,
        date: { gte: rangeStart, lte: rangeEnd },
        OR: [
          { type: "EXPENSE" },
          { type: "INVESTMENT", investmentAction: "BUY" },
        ],
      },
      _sum: { amount: true },
      _count: { _all: true },
    });
    const spendMap = new Map<string, { spend: number; txns: number }>();
    for (const r of spendAgg) {
      if (r.cardId)
        spendMap.set(r.cardId, {
          spend: Number(r._sum.amount ?? 0),
          txns: r._count._all,
        });
    }

    const rows = cards.map((c) => {
      const s = spendMap.get(c.id) ?? { spend: 0, txns: 0 };
      const creditLimit =
        c.account?.creditLimit == null ? null : Number(c.account.creditLimit);
      return {
        id: c.id,
        name: c.name,
        kind: c.kind,
        network: c.network,
        last4: c.last4,
        creditLimit,
        spend: round2(s.spend),
        txns: s.txns,
      };
    });

    const totals = {
      spend: round2(rows.reduce((s, r) => s + r.spend, 0)),
      txns: rows.reduce((s, r) => s + r.txns, 0),
    };

    return NextResponse.json({
      rangeStart: rangeStart.toISOString(),
      rangeEnd: rangeEnd.toISOString(),
      rows,
      totals,
    });
  } catch (e) {
    return err(e);
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
