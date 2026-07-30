import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { counterpartyName } from "@/lib/loan-direction";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[reports/loans]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

/**
 * Loan portfolio: every loan with its key fields plus totals settled. Split by
 * direction (borrowed = payables, lent = receivables) and then active vs closed.
 *
 * Interest comes from the LoanLedgerEntry rows when the loan has any — it is a
 * recorded fact there. Loans predating the ledger keep the old back-derivation
 * (total paid − principal drop), which is all that was ever knowable for them.
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
        ledgerEntries: {
          where: { kind: "REPAYMENT" },
          select: {
            principalAmount: true,
            interestAmount: true,
            gstAmount: true,
            amount: true,
          },
        },
        lenderContact: { select: { name: true } },
        borrowerContact: { select: { name: true } },
      },
    });

    const rows = loans.map((l) => {
      const principal = Number(l.principal);
      const outstanding = Number(l.outstanding);
      const paidPrincipal = Math.max(0, principal - outstanding);
      const hasLedger = l.ledgerEntries.length > 0;
      // On a lent loan the EXPENSE transactions are the disbursement, not
      // repayments, so the transaction-sum fallback is meaningless there — but
      // every lent loan has ledger entries by construction, so it never
      // reaches the fallback.
      const totalPaid = hasLedger
        ? l.ledgerEntries.reduce((s, e) => s + Number(e.amount), 0)
        : l.transactions.reduce((s, p) => s + Number(p.amount), 0);
      const paidInterest = hasLedger
        ? l.ledgerEntries.reduce(
            (s, e) => s + Number(e.interestAmount) + Number(e.gstAmount),
            0,
          )
        : Math.max(0, totalPaid - paidPrincipal);
      return {
        id: l.id,
        kind: l.kind,
        source: l.source,
        direction: l.direction,
        repaymentMode: l.repaymentMode,
        lender: counterpartyName(l),
        principal: round2(principal),
        outstanding: round2(outstanding),
        emiAmount: l.emiAmount == null ? null : Number(l.emiAmount),
        interestRate: l.interestRate == null ? null : Number(l.interestRate),
        frequency: l.frequency,
        interestCadence: l.interestCadence,
        startedAt: l.startedAt.toISOString(),
        maturityAt: l.maturityAt?.toISOString() ?? null,
        nextDueDate: l.nextDueDate?.toISOString() ?? null,
        active: l.active,
        foreclosedAt: l.foreclosedAt?.toISOString() ?? null,
        interestRecorded: hasLedger,
        totalPaid: round2(totalPaid),
        paidPrincipal: round2(paidPrincipal),
        paidInterest: round2(paidInterest),
        progressPct:
          principal > 0
            ? round2(Math.max(0, Math.min(100, ((principal - outstanding) / principal) * 100)))
            : 0,
      };
    });

    type Row = (typeof rows)[number];
    const summarise = (subset: Row[]) => {
      const active = subset.filter((r) => r.active);
      const closed = subset.filter((r) => !r.active);
      return {
        active,
        closed,
        totals: {
          principal: round2(active.reduce((s, r) => s + r.principal, 0)),
          outstanding: round2(active.reduce((s, r) => s + r.outstanding, 0)),
          paidPrincipal: round2(active.reduce((s, r) => s + r.paidPrincipal, 0)),
          paidInterest: round2(active.reduce((s, r) => s + r.paidInterest, 0)),
          totalPaid: round2(active.reduce((s, r) => s + r.totalPaid, 0)),
          activeCount: active.length,
          closedCount: closed.length,
        },
      };
    };

    const borrowed = summarise(rows.filter((r) => r.direction !== "LENT"));
    const lent = summarise(rows.filter((r) => r.direction === "LENT"));

    // The three legacy top-level keys carry the BORROWED rows only, so the
    // existing report page renders unchanged and its "outstanding" total never
    // mixes a payable with a receivable.
    return NextResponse.json({
      borrowed,
      lent,
      active: borrowed.active,
      closed: borrowed.closed,
      totals: borrowed.totals,
    });
  } catch (e) {
    return err(e);
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
