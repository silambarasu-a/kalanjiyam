import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { canAccessRecord } from "@/lib/permissions";
import { loanPaymentSchema } from "@/lib/validators-domain";
import { splitPayment, advanceByCycle, type LoanFrequency } from "@/lib/loan-math";
import { nextStatementDueDate } from "@/lib/statement-period";
import { TransactionType, TransactionKind } from "@/generated/prisma/client";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[loan/pay]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

function featureForSource(source: string) {
  return source === "BANK" ? "bank_loans" : source === "CARD_EMI" ? "card_emi" : "hand_loans";
}

/**
 * Post an EMI / principal payment against a loan. Creates an EXPENSE
 * transaction and decrements Loan.outstanding by the principal portion
 * (or full amount if the split isn't supplied).
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const loan = await prisma.loan.findUnique({ where: { id } });
    if (!loan) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const ctx = await requireWorkspace(featureForSource(loan.source), "write");
    const session = await auth();
    if (loan.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const body = await request.json();
    const parsed = loanPaymentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const data = parsed.data;

    let resolvedAccountId: string | null = data.accountId ?? null;
    if (data.cardId) {
      const card = await prisma.card.findUnique({ where: { id: data.cardId } });
      if (!card || card.workspaceId !== ctx.workspaceId) {
        return NextResponse.json({ error: "Card not found" }, { status: 404 });
      }
      if (!canAccessRecord(session, card)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      resolvedAccountId = card.accountId ?? resolvedAccountId;
    }
    if (!resolvedAccountId) {
      return NextResponse.json({ error: "Pick an account or card" }, { status: 400 });
    }

    // Auto-split when the client didn't supply principal/interest portions.
    // Standard reducing-balance: interest = outstanding · periodicRate. GST
    // (card EMI) sits on top of interest. Whatever remains of `amount` is
    // principal, clamped at outstanding so the loan can't go negative.
    const annualRate = loan.interestRate ? Number(loan.interestRate) : 0;
    const gstPct = loan.gstOnInterest ? Number(loan.gstOnInterest) : null;
    const emiHint = loan.emiAmount ? Number(loan.emiAmount) : data.amount;
    const frequency = (loan.frequency ?? "MONTHLY") as LoanFrequency;

    const suggested = splitPayment(
      Number(loan.outstanding),
      annualRate,
      Math.min(emiHint, data.amount),
      frequency,
      gstPct
    );

    const interestPortion =
      data.interestPortion != null ? data.interestPortion : suggested.interest;
    const gstPortion =
      data.gstPortion != null ? data.gstPortion : suggested.gst;
    const principalDrop =
      data.principalPortion != null
        ? data.principalPortion
        : Math.max(0, data.amount - interestPortion - gstPortion);

    const newOutstanding = Math.max(0, Number(loan.outstanding) - principalDrop);

    // Advance nextDueDate by one cycle when the principal portion covers
    // (close to) one full EMI principal. Heuristic, but matches what banks
    // do — partial pre-payments don't shift the schedule.
    //
    // The CREDIT_CARD_LOAN kind advances along the linked card's billing
    // cycle — the next due is "next statement-close + grace" relative to
    // the payment date, not a fixed monthly anniversary.
    // Per-loan overrides win over the linked card's account values.
    let cardStatement: { statementDate: number | null; gracePeriod: number | null } | null = null;
    if (loan.kind === "CREDIT_CARD_LOAN" && loan.cardId) {
      const card = await prisma.card.findUnique({
        where: { id: loan.cardId },
        include: {
          account: { select: { statementDate: true, gracePeriod: true } },
        },
      });
      cardStatement = card?.account
        ? { statementDate: card.account.statementDate, gracePeriod: card.account.gracePeriod }
        : null;
    }
    const effectiveStatementDate =
      loan.kind === "CREDIT_CARD_LOAN"
        ? loan.loanStatementDate ?? cardStatement?.statementDate ?? null
        : null;
    const effectiveGracePeriod =
      loan.kind === "CREDIT_CARD_LOAN"
        ? loan.loanGracePeriod ?? cardStatement?.gracePeriod ?? 0
        : 0;
    const nextDue = (() => {
      if (!loan.nextDueDate) return loan.nextDueDate;
      if (newOutstanding <= 0) return null;
      // Treat anything within 1% of the suggested principal as a full EMI.
      const fullEmiPaid = principalDrop >= suggested.principal * 0.99;
      if (!fullEmiPaid) return loan.nextDueDate;
      if (
        loan.kind === "CREDIT_CARD_LOAN" &&
        effectiveStatementDate != null
      ) {
        return nextStatementDueDate(
          new Date(data.paidAt),
          effectiveStatementDate,
          effectiveGracePeriod,
        );
      }
      return advanceByCycle(new Date(loan.nextDueDate), frequency, 1);
    })();

    await prisma.$transaction(async (tx) => {
      const txn = await tx.transaction.create({
        data: {
          workspaceId: ctx.workspaceId,
          type: TransactionType.EXPENSE,
          kind: TransactionKind.LOAN_PAYMENT,
          amount: data.amount,
          description: `Loan payment · ${loan.lender}${data.notes ? ` · ${data.notes}` : ""}`,
          date: new Date(data.paidAt),
          accountId: resolvedAccountId,
          cardId: data.cardId ?? null,
          loanId: id,
          userId: ctx.userId,
          createdByUserId: ctx.userId,
        },
      });
      await tx.loan.update({
        where: { id },
        data: {
          outstanding: newOutstanding,
          nextDueDate: nextDue,
          active: newOutstanding > 0 ? loan.active : false,
          foreclosedAt:
            newOutstanding === 0 && loan.active ? new Date() : loan.foreclosedAt,
        },
      });
      return txn;
    });

    return NextResponse.json({
      ok: true,
      outstanding: newOutstanding,
      split: {
        principal: principalDrop,
        interest: interestPortion,
        gst: gstPortion,
      },
    });
  } catch (e) {
    return err(e);
  }
}
