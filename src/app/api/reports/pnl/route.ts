import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[reports/pnl]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

/**
 * Profit & Loss by category for a given window. Returns income and expense
 * rows aggregated per Category, plus prior-period comparison so users can
 * see month-over-month or quarter-over-quarter movement.
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
    const span = rangeEnd.getTime() - rangeStart.getTime();
    const prevStart = new Date(rangeStart.getTime() - span - 1);
    const prevEnd = new Date(rangeStart.getTime() - 1);

    const [current, previous] = await Promise.all([
      aggregateByCategory(ctx.workspaceId, rangeStart, rangeEnd),
      aggregateByCategory(ctx.workspaceId, prevStart, prevEnd),
    ]);

    const prevByKey = new Map(previous.map((r) => [`${r.type}:${r.id}`, r]));
    const merged = current.map((c) => {
      const prev = prevByKey.get(`${c.type}:${c.id}`);
      const prevAmount = prev?.amount ?? 0;
      const change = c.amount - prevAmount;
      const changePct =
        prevAmount > 0 ? (change / prevAmount) * 100 : prevAmount === 0 && c.amount > 0 ? 100 : 0;
      return { ...c, prevAmount: round2(prevAmount), change: round2(change), changePct: round2(changePct) };
    });

    const income = merged.filter((r) => r.type === "INCOME").sort((a, b) => b.amount - a.amount);
    const expense = merged.filter((r) => r.type === "EXPENSE").sort((a, b) => b.amount - a.amount);

    const totals = {
      income: round2(income.reduce((s, r) => s + r.amount, 0)),
      expense: round2(expense.reduce((s, r) => s + r.amount, 0)),
      prevIncome: round2(income.reduce((s, r) => s + r.prevAmount, 0)),
      prevExpense: round2(expense.reduce((s, r) => s + r.prevAmount, 0)),
    };

    return NextResponse.json({
      rangeStart: rangeStart.toISOString(),
      rangeEnd: rangeEnd.toISOString(),
      prevStart: prevStart.toISOString(),
      prevEnd: prevEnd.toISOString(),
      income,
      expense,
      totals: {
        ...totals,
        net: round2(totals.income - totals.expense),
        prevNet: round2(totals.prevIncome - totals.prevExpense),
      },
    });
  } catch (e) {
    return err(e);
  }
}

async function aggregateByCategory(
  workspaceId: string,
  start: Date,
  end: Date,
) {
  const rows = await prisma.transaction.findMany({
    where: {
      workspaceId,
      transferId: null,
      type: { in: ["INCOME", "EXPENSE"] },
      date: { gte: start, lte: end },
    },
    select: {
      amount: true,
      type: true,
      category: {
        select: {
          id: true,
          name: true,
          group: true,
          parent: { select: { name: true } },
        },
      },
    },
  });
  const map = new Map<
    string,
    {
      id: string;
      name: string;
      parentName: string | null;
      group: string | null;
      type: string;
      amount: number;
      count: number;
    }
  >();
  for (const r of rows) {
    const cid = r.category?.id ?? "uncategorized";
    const key = `${r.type}:${cid}`;
    const existing = map.get(key);
    const amt = Number(r.amount);
    if (existing) {
      existing.amount += amt;
      existing.count += 1;
    } else {
      map.set(key, {
        id: cid,
        name: r.category?.name ?? "Uncategorized",
        parentName: r.category?.parent?.name ?? null,
        group: r.category?.group ?? null,
        type: r.type,
        amount: amt,
        count: 1,
      });
    }
  }
  return Array.from(map.values()).map((r) => ({
    ...r,
    amount: round2(r.amount),
  }));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
