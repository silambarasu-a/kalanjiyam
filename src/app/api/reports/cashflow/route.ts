import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[reports/cashflow]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

/**
 * Monthly cashflow within an arbitrary date range. Backwards-compatible:
 * if `start` / `end` aren't supplied, falls back to `months=N` (default 12).
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireWorkspace("reports", "read");
    const url = new URL(request.url);
    const startStr = url.searchParams.get("start");
    const endStr = url.searchParams.get("end");

    let rangeStart: Date;
    let rangeEnd: Date;
    if (startStr && endStr) {
      rangeStart = new Date(`${startStr}T00:00:00Z`);
      rangeEnd = new Date(`${endStr}T23:59:59Z`);
    } else {
      const months = Math.min(36, Math.max(1, Number(url.searchParams.get("months") ?? "12")));
      const now = new Date();
      rangeStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months + 1, 1));
      rangeEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59));
    }

    const txns = await prisma.transaction.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        transferId: null,
        type: { in: ["INCOME", "EXPENSE"] },
        date: { gte: rangeStart, lte: rangeEnd },
      },
      select: {
        amount: true,
        type: true,
        date: true,
        category: { select: { id: true, name: true, group: true } },
      },
    });

    const buckets = new Map<string, { income: number; expense: number }>();
    {
      const start = new Date(Date.UTC(rangeStart.getUTCFullYear(), rangeStart.getUTCMonth(), 1));
      const end = new Date(Date.UTC(rangeEnd.getUTCFullYear(), rangeEnd.getUTCMonth(), 1));
      for (let d = new Date(start); d <= end; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
        buckets.set(monthKey(d), { income: 0, expense: 0 });
      }
    }
    const categoryAgg = new Map<
      string,
      { id: string; name: string; group: string | null; income: number; expense: number }
    >();

    for (const t of txns) {
      const key = monthKey(t.date);
      const bucket = buckets.get(key);
      if (bucket) {
        const amt = Number(t.amount);
        if (t.type === "INCOME") bucket.income += amt;
        if (t.type === "EXPENSE") bucket.expense += amt;
      }
      if (t.category) {
        const existing = categoryAgg.get(t.category.id) ?? {
          id: t.category.id,
          name: t.category.name,
          group: t.category.group,
          income: 0,
          expense: 0,
        };
        const amt = Number(t.amount);
        if (t.type === "INCOME") existing.income += amt;
        if (t.type === "EXPENSE") existing.expense += amt;
        categoryAgg.set(t.category.id, existing);
      }
    }

    const series = Array.from(buckets.entries()).map(([key, v]) => ({
      month: key,
      income: Math.round(v.income * 100) / 100,
      expense: Math.round(v.expense * 100) / 100,
      net: Math.round((v.income - v.expense) * 100) / 100,
    }));
    const totals = series.reduce(
      (acc, s) => ({ income: acc.income + s.income, expense: acc.expense + s.expense }),
      { income: 0, expense: 0 }
    );

    const topIncome = Array.from(categoryAgg.values())
      .filter((c) => c.income > 0)
      .sort((a, b) => b.income - a.income)
      .slice(0, 5)
      .map((c) => ({ id: c.id, name: c.name, group: c.group, amount: Math.round(c.income * 100) / 100 }));
    const topExpense = Array.from(categoryAgg.values())
      .filter((c) => c.expense > 0)
      .sort((a, b) => b.expense - a.expense)
      .slice(0, 5)
      .map((c) => ({ id: c.id, name: c.name, group: c.group, amount: Math.round(c.expense * 100) / 100 }));

    return NextResponse.json({
      rangeStart: rangeStart.toISOString(),
      rangeEnd: rangeEnd.toISOString(),
      series,
      totals: {
        income: Math.round(totals.income * 100) / 100,
        expense: Math.round(totals.expense * 100) / 100,
        net: Math.round((totals.income - totals.expense) * 100) / 100,
      },
      topIncome,
      topExpense,
    });
  } catch (e) {
    return err(e);
  }
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
