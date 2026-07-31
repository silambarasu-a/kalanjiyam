import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { splitPayment, type LoanFrequency } from "@/lib/loan-math";
import {
  accrualAnchor,
  applyPaymentBankStyle,
  recalculatedEmi,
  remainingCycles,
} from "@/lib/loan-accrual";
import { LoanLedgerKind } from "@/generated/prisma/client";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[loan/accrual]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

function featureForSource(source: string) {
  return source === "BANK" ? "bank_loans" : source === "CARD_EMI" ? "card_emi" : "hand_loans";
}

/**
 * Preview how a payment of `amount` on `asOf` would split, without recording
 * anything. Mirrors the math in POST /api/loans/[id]/pay exactly — the two must
 * never disagree, or the dialog would promise a split the route then overrides.
 *
 * A route rather than props threaded into the dialog: the pay dialog mounts
 * from the loan detail page, the loans list, dashboard "Pay" shortcuts and the
 * notification dues list, and the anchor needs ledger history that most of
 * those call sites don't load. One SWR fetch keyed on the date beats four
 * separate query changes, and it lets the split update live as the user edits
 * the payment date.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const loan = await prisma.loan.findUnique({
      where: { id },
      include: {
        ledgerEntries: {
          where: { kind: LoanLedgerKind.REPAYMENT },
          select: { paidAt: true, periodTo: true, interestAmount: true },
        },
      },
    });
    if (!loan) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const ctx = await requireWorkspace(featureForSource(loan.source), "read");
    if (loan.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const url = new URL(request.url);
    const asOfParam = url.searchParams.get("asOf");
    const amountParam = Number(url.searchParams.get("amount") ?? "0");
    const asOf = asOfParam ? new Date(asOfParam) : new Date();
    if (Number.isNaN(asOf.getTime())) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }
    const amount = Number.isFinite(amountParam) ? Math.max(0, amountParam) : 0;

    const annualRate = loan.interestRate ? Number(loan.interestRate) : 0;
    const gstPct = loan.gstOnInterest ? Number(loan.gstOnInterest) : null;
    const frequency = (loan.frequency ?? "MONTHLY") as LoanFrequency;
    const outstanding = Number(loan.outstanding);
    const emiHint = loan.emiAmount ? Number(loan.emiAmount) : amount;

    // CARD_EMI keeps the fixed formula split — see the note in /pay.
    if (loan.source === "CARD_EMI" || loan.repaymentMode === "AD_HOC") {
      const s = splitPayment(
        outstanding,
        annualRate,
        Math.min(emiHint, amount || emiHint),
        frequency,
        gstPct,
      );
      return NextResponse.json({
        timeAware: false,
        anchor: null,
        days: null,
        cycleDays: null,
        interest: s.interest,
        gst: s.gst,
        principal: Math.max(0, amount - s.interest - s.gst),
        outstanding,
        newOutstanding: Math.max(0, outstanding - Math.max(0, amount - s.interest - s.gst)),
        emiAmount: loan.emiAmount ? Number(loan.emiAmount) : null,
        newEmi: null,
        remainingCycles: null,
        excess: 0,
        shortfall: 0,
      });
    }

    const anchor = accrualAnchor({
      startedAt: loan.startedAt,
      nextDueDate: loan.nextDueDate,
      frequency,
      entries: loan.ledgerEntries.map((e) => ({
        paidAt: e.paidAt,
        periodTo: e.periodTo,
        interestAmount: Number(e.interestAmount),
      })),
    });

    const split = applyPaymentBankStyle({
      amount,
      outstanding,
      annualRate,
      frequency,
      gstOnInterestPct: gstPct,
      from: anchor,
      to: asOf,
    });

    const newOutstanding = Math.max(0, outstanding - split.principal);

    return NextResponse.json({
      timeAware: true,
      anchor: anchor.toISOString(),
      days: Math.round(split.days),
      cycleDays: Math.round(split.cycleDays),
      interest: split.interest,
      gst: split.gst,
      principal: split.principal,
      outstanding,
      newOutstanding,
      // What it would take to clear the loan on this date.
      payoff: Math.round((outstanding + split.interest + split.gst) * 100) / 100,
      emiAmount: loan.emiAmount ? Number(loan.emiAmount) : null,
      newEmi:
        newOutstanding > 0
          ? recalculatedEmi({
              outstanding: newOutstanding,
              annualRate,
              frequency,
              maturityAt: loan.maturityAt,
              asOf,
            })
          : null,
      // Lets the dialog re-amortize locally as the user types an amount,
      // instead of refetching on every keystroke — the accrued interest above
      // depends only on the date, so one fetch per date change is enough.
      remainingCycles:
        loan.maturityAt && annualRate > 0
          ? remainingCycles(asOf, loan.maturityAt, frequency)
          : null,
      excess: split.excess,
      shortfall: split.shortfall,
    });
  } catch (e) {
    return err(e);
  }
}
