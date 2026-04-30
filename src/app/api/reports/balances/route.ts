import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[reports/balances]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

/**
 * Account balance snapshot at a chosen `asOf` date. Computes
 *   balance = openingBalance + Σ income(≤ asOf) − Σ expense(≤ asOf)
 *           + Σ transfersIn(≤ asOf) − Σ transfersOut(≤ asOf)
 * for every active account in the workspace.
 *
 * Same arithmetic as src/lib/account-balance.ts, but applied to a date
 * filter so we can render historical or future-dated snapshots.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireWorkspace("reports", "read");
    const url = new URL(request.url);
    const asOfStr = url.searchParams.get("asOf") ?? new Date().toISOString().slice(0, 10);
    const asOf = new Date(`${asOfStr}T23:59:59Z`);

    const accounts = await prisma.account.findMany({
      where: { workspaceId: ctx.workspaceId, active: true },
      orderBy: [{ kind: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        kind: true,
        openingBalance: true,
        creditLimit: true,
      },
    });

    const ids = accounts.map((a) => a.id);
    if (ids.length === 0) {
      return NextResponse.json({
        asOf: asOf.toISOString(),
        accounts: [],
        totals: { assets: 0, liabilities: 0, net: 0 },
      });
    }

    const [incomeAgg, expenseAgg, transferInAgg, transferOutAgg] =
      await Promise.all([
        prisma.transaction.groupBy({
          by: ["accountId"],
          where: {
            accountId: { in: ids },
            type: "INCOME",
            transferId: null,
            date: { lte: asOf },
          },
          _sum: { amount: true },
        }),
        prisma.transaction.groupBy({
          by: ["accountId"],
          where: {
            accountId: { in: ids },
            transferId: null,
            date: { lte: asOf },
            OR: [
              { type: "EXPENSE" },
              { type: "INVESTMENT", investmentAction: "BUY" },
            ],
          },
          _sum: { amount: true },
        }),
        prisma.transfer.groupBy({
          by: ["toAccountId"],
          where: { toAccountId: { in: ids }, date: { lte: asOf } },
          _sum: { amount: true },
        }),
        prisma.transfer.groupBy({
          by: ["fromAccountId"],
          where: { fromAccountId: { in: ids }, date: { lte: asOf } },
          _sum: { amount: true },
        }),
      ]);

    const incomeMap = new Map<string, number>();
    for (const r of incomeAgg) {
      if (r.accountId) incomeMap.set(r.accountId, Number(r._sum.amount ?? 0));
    }
    const expenseMap = new Map<string, number>();
    for (const r of expenseAgg) {
      if (r.accountId) expenseMap.set(r.accountId, Number(r._sum.amount ?? 0));
    }
    const inMap = new Map<string, number>();
    for (const r of transferInAgg) {
      if (r.toAccountId) inMap.set(r.toAccountId, Number(r._sum.amount ?? 0));
    }
    const outMap = new Map<string, number>();
    for (const r of transferOutAgg) {
      if (r.fromAccountId) outMap.set(r.fromAccountId, Number(r._sum.amount ?? 0));
    }

    const rows = accounts.map((a) => {
      const opening = Number(a.openingBalance);
      const income = incomeMap.get(a.id) ?? 0;
      const expense = expenseMap.get(a.id) ?? 0;
      const tin = inMap.get(a.id) ?? 0;
      const tout = outMap.get(a.id) ?? 0;
      const balance =
        a.kind === "CARD"
          ? opening + expense - income + tout - tin
          : opening + income - expense + tin - tout;
      return {
        id: a.id,
        name: a.name,
        kind: a.kind,
        openingBalance: round2(opening),
        income: round2(income),
        expense: round2(expense),
        transfersIn: round2(tin),
        transfersOut: round2(tout),
        balance: round2(balance),
        creditLimit: a.creditLimit == null ? null : Number(a.creditLimit),
      };
    });

    const assets = rows
      .filter((r) => r.kind !== "CARD")
      .reduce((s, r) => s + r.balance, 0);
    const liabilities = rows
      .filter((r) => r.kind === "CARD")
      .reduce((s, r) => s + r.balance, 0);

    return NextResponse.json({
      asOf: asOf.toISOString(),
      accounts: rows,
      totals: {
        assets: round2(assets),
        liabilities: round2(liabilities),
        net: round2(assets - liabilities),
      },
    });
  } catch (e) {
    return err(e);
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
