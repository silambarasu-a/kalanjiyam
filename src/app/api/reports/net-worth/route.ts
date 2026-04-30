import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[reports/net-worth]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

/**
 * Monthly net-worth snapshot: liquid assets (bank/cash/wallet balances) +
 * investments at current value − card liabilities − loan outstanding.
 *
 * For each calendar month in the window, takes the balance as of the LAST
 * day of that month. Investments and loans use a point-in-time approximation
 * — investment.amount as cost basis (current value not historicalized), loan
 * outstanding from the live record (we don't store historic outstanding).
 * "Today" snapshot uses the most precise live data.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireWorkspace("reports", "read");
    const url = new URL(request.url);
    const months = Math.min(36, Math.max(1, Number(url.searchParams.get("months") ?? "12")));

    const now = new Date();
    const endOfThisMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59),
    );

    // Build the list of month-end snapshot dates (oldest → newest).
    const snapshots: Date[] = [];
    for (let i = months - 1; i >= 0; i--) {
      snapshots.push(
        new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 0, 23, 59, 59),
        ),
      );
    }

    const accounts = await prisma.account.findMany({
      where: { workspaceId: ctx.workspaceId, active: true },
      select: { id: true, kind: true, openingBalance: true },
    });
    const ids = accounts.map((a) => a.id);

    // For each snapshot date, compute liquid + card balances. To keep this
    // scalable, we batch-query all transactions/transfers up to the latest
    // snapshot once, then bucket per snapshot in JS.
    const [allTxnRows, allTransferRows, investments, loans] = await Promise.all([
      ids.length === 0
        ? Promise.resolve([])
        : prisma.transaction.findMany({
            where: {
              accountId: { in: ids },
              transferId: null,
              date: { lte: endOfThisMonth },
              OR: [
                { type: "INCOME" },
                { type: "EXPENSE" },
                { type: "INVESTMENT", investmentAction: "BUY" },
              ],
            },
            select: { accountId: true, type: true, investmentAction: true, amount: true, date: true },
          }),
      ids.length === 0
        ? Promise.resolve([])
        : prisma.transfer.findMany({
            where: {
              workspaceId: ctx.workspaceId,
              date: { lte: endOfThisMonth },
              OR: [{ fromAccountId: { in: ids } }, { toAccountId: { in: ids } }],
            },
            select: { fromAccountId: true, toAccountId: true, amount: true, date: true },
          }),
      prisma.investment.findMany({
        where: { workspaceId: ctx.workspaceId, active: true },
        select: { amount: true, currentValue: true, startedAt: true },
      }),
      prisma.loan.findMany({
        where: { workspaceId: ctx.workspaceId, active: true },
        select: { outstanding: true, startedAt: true },
      }),
    ]);

    const accountKind = new Map(accounts.map((a) => [a.id, a.kind]));
    const opening = new Map(accounts.map((a) => [a.id, Number(a.openingBalance)]));

    const series = snapshots.map((snap) => {
      // Per-account running balance up to `snap`.
      const balances = new Map<string, number>(opening);
      for (const t of allTxnRows) {
        if (!t.accountId) continue;
        if (t.date > snap) continue;
        const kind = accountKind.get(t.accountId);
        if (!kind) continue;
        const amt = Number(t.amount);
        const isOutflow =
          t.type === "EXPENSE" ||
          (t.type === "INVESTMENT" && t.investmentAction === "BUY");
        const delta =
          kind === "CARD"
            ? (isOutflow ? amt : -amt) // CARD: expense increases debt, income reduces
            : (isOutflow ? -amt : amt);
        balances.set(t.accountId, (balances.get(t.accountId) ?? 0) + delta);
      }
      for (const tf of allTransferRows) {
        if (tf.date > snap) continue;
        const amt = Number(tf.amount);
        if (tf.fromAccountId) {
          const kind = accountKind.get(tf.fromAccountId);
          if (kind) {
            const delta = kind === "CARD" ? amt : -amt;
            balances.set(
              tf.fromAccountId,
              (balances.get(tf.fromAccountId) ?? 0) + delta,
            );
          }
        }
        if (tf.toAccountId) {
          const kind = accountKind.get(tf.toAccountId);
          if (kind) {
            const delta = kind === "CARD" ? -amt : amt;
            balances.set(
              tf.toAccountId,
              (balances.get(tf.toAccountId) ?? 0) + delta,
            );
          }
        }
      }

      let liquid = 0;
      let cards = 0;
      for (const [id, b] of balances) {
        if (accountKind.get(id) === "CARD") cards += b;
        else liquid += b;
      }

      // Investments / loans approximation: include only those that existed
      // by `snap`. Use cost basis for investments — point-in-time value
      // isn't tracked historically.
      const invested = investments
        .filter((i) => i.startedAt <= snap)
        .reduce((s, i) => s + Number(i.currentValue ?? i.amount), 0);
      const loanOutstanding = loans
        .filter((l) => l.startedAt <= snap)
        .reduce((s, l) => s + Number(l.outstanding), 0);

      const assets = liquid + invested;
      const liabilities = cards + loanOutstanding;
      return {
        month: monthKey(snap),
        liquid: round2(liquid),
        invested: round2(invested),
        cards: round2(cards),
        loans: round2(loanOutstanding),
        assets: round2(assets),
        liabilities: round2(liabilities),
        net: round2(assets - liabilities),
      };
    });

    const last = series[series.length - 1];
    const first = series[0];
    const change = last && first ? round2(last.net - first.net) : 0;
    const changePct =
      first && first.net !== 0 ? round2(((last.net - first.net) / Math.abs(first.net)) * 100) : 0;

    return NextResponse.json({
      months,
      series,
      latest: last ?? null,
      change,
      changePct,
    });
  } catch (e) {
    return err(e);
  }
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
