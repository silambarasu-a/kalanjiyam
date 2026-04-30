import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[reports/loans]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

/**
 * Loan portfolio: every loan with its key fields plus totals paid via the
 * recorded LoanPayment ledger. Splits into active vs closed.
 */
export async function GET() {
  try {
    const ctx = await requireWorkspace("reports", "read");
    const loans = await prisma.loan.findMany({
      where: { workspaceId: ctx.workspaceId },
      orderBy: [{ active: "desc" }, { startedAt: "desc" }],
      include: {
        transactions: {
          where: { type: "EXPENSE", transferId: null },
          select: { amount: true },
        },
      },
    });

    const rows = loans.map((l) => {
      const totalPaid = l.transactions.reduce((s, p) => s + Number(p.amount), 0);
      const principal = Number(l.principal);
      const outstanding = Number(l.outstanding);
      const paidPrincipal = Math.max(0, principal - outstanding);
      const paidInterest = Math.max(0, totalPaid - paidPrincipal);
      return {
        id: l.id,
        kind: l.kind,
        source: l.source,
        lender: l.lender,
        principal: round2(principal),
        outstanding: round2(outstanding),
        emiAmount: l.emiAmount == null ? null : Number(l.emiAmount),
        interestRate: l.interestRate == null ? null : Number(l.interestRate),
        frequency: l.frequency,
        startedAt: l.startedAt.toISOString(),
        maturityAt: l.maturityAt?.toISOString() ?? null,
        nextDueDate: l.nextDueDate?.toISOString() ?? null,
        active: l.active,
        foreclosedAt: l.foreclosedAt?.toISOString() ?? null,
        totalPaid: round2(totalPaid),
        paidPrincipal: round2(paidPrincipal),
        paidInterest: round2(paidInterest),
        progressPct:
          principal > 0
            ? round2(Math.max(0, Math.min(100, ((principal - outstanding) / principal) * 100)))
            : 0,
      };
    });

    const active = rows.filter((r) => r.active);
    const closed = rows.filter((r) => !r.active);

    const totals = {
      principal: round2(active.reduce((s, r) => s + r.principal, 0)),
      outstanding: round2(active.reduce((s, r) => s + r.outstanding, 0)),
      paidPrincipal: round2(active.reduce((s, r) => s + r.paidPrincipal, 0)),
      paidInterest: round2(active.reduce((s, r) => s + r.paidInterest, 0)),
      totalPaid: round2(active.reduce((s, r) => s + r.totalPaid, 0)),
      activeCount: active.length,
      closedCount: closed.length,
    };

    return NextResponse.json({ active, closed, totals });
  } catch (e) {
    return err(e);
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
