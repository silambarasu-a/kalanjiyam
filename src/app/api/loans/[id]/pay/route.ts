import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { canAccessRecord } from "@/lib/permissions";
import { loanPaymentSchema } from "@/lib/validators-domain";
import { splitPayment, advanceByCycle, type LoanFrequency } from "@/lib/loan-math";
import {
  accrualAnchor,
  applyPaymentBankStyle,
  recalculatedEmi,
} from "@/lib/loan-accrual";
import { nextStatementDueDate } from "@/lib/statement-period";
import {
  TransactionType,
  TransactionKind,
  LoanLedgerKind,
} from "@/generated/prisma/client";

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
    const loan = await prisma.loan.findUnique({
      where: { id },
      include: {
        lenderContact: { select: { name: true } },
        // Needed to resolve the accrual anchor — the date interest is already
        // settled up to. Only repayments move that mark.
        ledgerEntries: {
          where: { kind: LoanLedgerKind.REPAYMENT },
          select: { paidAt: true, periodTo: true, interestAmount: true },
        },
      },
    });
    if (!loan) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const ctx = await requireWorkspace(featureForSource(loan.source), "write");
    const session = await auth();
    if (loan.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    // Money you lent out moves the other way and has no EMI to split against —
    // /settle handles it. Rejected rather than redirected so a mis-wired client
    // can't post an EXPENSE against a receivable.
    if (loan.direction === "LENT") {
      return NextResponse.json(
        { error: "This is money you lent — record a settlement instead." },
        { status: 400 },
      );
    }
    // A bullet loan has no instalment to split against — /settle takes the
    // user-entered interest instead. Mirrors /settle's rejection of EMI loans,
    // so a mis-wired client can never force the amortization formula onto a
    // loan whose parties never agreed to one. Reachable since bullet mode
    // opened up to BANK loans (gold / overdraft), not just hand loans.
    if (loan.repaymentMode === "AD_HOC") {
      return NextResponse.json(
        { error: "This loan has no EMI — record a settlement instead." },
        { status: 400 },
      );
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
    //
    // Interest is charged for the days that actually elapsed since the last
    // settled date, pro-rated over the cycle — the way a bank does it. The old
    // formula-only split (`outstanding · periodicRate`, no date input) billed a
    // whole cycle no matter when the payment landed, so a YEARLY gold loan paid
    // a month in was charged a full year of interest and almost nothing reached
    // the principal.
    //
    // CARD_EMI deliberately keeps the formula split: the issuer bills a fixed
    // instalment and a fixed interest charge per statement cycle, and paying
    // early doesn't reduce either. Recomputing it here would make the app
    // disagree with the statement it's supposed to mirror.
    const annualRate = loan.interestRate ? Number(loan.interestRate) : 0;
    const gstPct = loan.gstOnInterest ? Number(loan.gstOnInterest) : null;
    const emiHint = loan.emiAmount ? Number(loan.emiAmount) : data.amount;
    const frequency = (loan.frequency ?? "MONTHLY") as LoanFrequency;
    const outstandingNow = Number(loan.outstanding);
    const isCardEmi = loan.source === "CARD_EMI";
    const paidAtDate = new Date(data.paidAt);

    const anchor = isCardEmi
      ? null
      : accrualAnchor({
          startedAt: loan.startedAt,
          nextDueDate: loan.nextDueDate,
          frequency,
          entries: loan.ledgerEntries.map((e) => ({
            paidAt: e.paidAt,
            periodTo: e.periodTo,
            interestAmount: Number(e.interestAmount),
          })),
        });

    const accrued = anchor
      ? applyPaymentBankStyle({
          amount: data.amount,
          outstanding: outstandingNow,
          annualRate,
          frequency,
          gstOnInterestPct: gstPct,
          from: anchor,
          to: paidAtDate,
        })
      : null;

    const suggested = accrued
      ? { interest: accrued.interest, gst: accrued.gst, principal: accrued.principal }
      : // Untouched formula split — CARD_EMI must keep splitting exactly as it
        // did, including the principal figure the due-date roll below tests
        // against.
        splitPayment(
          outstandingNow,
          annualRate,
          Math.min(emiHint, data.amount),
          frequency,
          gstPct
        );

    // You can't overpay a loan. The old code clamped principal at the
    // outstanding and let the surplus vanish into a larger EXPENSE row, leaving
    // the account balance short with nothing to show for it. Only checked on
    // the auto-split path — an explicit override is the user telling us exactly
    // where the money went. Rupee tolerance absorbs rounding on a final EMI.
    const usingAutoSplit =
      data.principalPortion == null &&
      data.interestPortion == null &&
      data.gstPortion == null;
    if (accrued && usingAutoSplit && accrued.excess > 1) {
      const payoff = outstandingNow + accrued.interest + accrued.gst;
      return NextResponse.json(
        {
          error: `That's ₹${accrued.excess.toFixed(2)} more than this loan owes. Pay ₹${payoff.toFixed(2)} to close it in full.`,
        },
        { status: 400 },
      );
    }

    const interestPortion =
      data.interestPortion != null ? data.interestPortion : suggested.interest;
    const gstPortion =
      data.gstPortion != null ? data.gstPortion : suggested.gst;
    // Clamped at the outstanding so the stored split can never claim more
    // principal than the loan had left — the ledger entry is what a later
    // delete or edit reverses, so an inflated figure here would over-restore
    // the balance.
    const principalDrop = Math.min(
      outstandingNow,
      data.principalPortion != null
        ? data.principalPortion
        : Math.max(0, data.amount - interestPortion - gstPortion),
    );

    const newOutstanding = Math.max(0, outstandingNow - principalDrop);

    // Advance nextDueDate by one cycle when the principal portion covers
    // (close to) one full EMI principal. Heuristic, but matches what banks
    // do — partial pre-payments don't shift the schedule.
    //
    // The CREDIT_CARD_LOAN kind advances along the linked card's billing
    // cycle — the next due is the statement due date one cycle after the
    // current one, not a fixed monthly anniversary. We advance from the
    // current due date (+1 day) rather than the payment date so paying
    // early or late doesn't shift the schedule.
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
      // Did this payment actually retire a scheduled instalment?
      //
      // The old test — principal covered ~all of the formula's principal
      // portion — is meaningless once the split is time-aware: an early
      // part-payment accrues little interest and so lands a large principal
      // portion, which would have rolled the due date forward for a payment
      // that settled nothing. Now it takes both a full instalment's worth of
      // cash AND a full cycle of elapsed time. A part-prepayment leaves the due
      // date where it is, which is what banks do.
      //
      // CARD_EMI has no accrual (fixed statement instalment), so it keeps the
      // original principal-based test.
      const fullEmiPaid = accrued
        ? data.amount >= emiHint * 0.99 && accrued.fraction >= 0.99
        : principalDrop >= suggested.principal * 0.99;
      if (!fullEmiPaid) return loan.nextDueDate;
      if (
        loan.kind === "CREDIT_CARD_LOAN" &&
        effectiveStatementDate != null
      ) {
        // +1 day so the on-or-after lookup lands on the NEXT cycle's due
        // date rather than returning the current due date unchanged.
        return nextStatementDueDate(
          new Date(loan.nextDueDate.getTime() + 24 * 60 * 60 * 1000),
          effectiveStatementDate,
          effectiveGracePeriod,
        );
      }
      return advanceByCycle(new Date(loan.nextDueDate), frequency, 1);
    })();

    // Re-amortize what's left over the cycles remaining to maturity, so the
    // instalment reflects the balance the borrower actually carries. A
    // part-prepayment keeps the tenure and lowers the EMI (the chosen policy);
    // `tenure` and `maturityAt` are never touched here.
    //
    // Skipped for CARD_EMI — the issuer's instalment is contractual, and
    // rewriting it would misreport the statement.
    const newEmi =
      !isCardEmi && newOutstanding > 0
        ? recalculatedEmi({
            outstanding: newOutstanding,
            annualRate,
            frequency,
            maturityAt: loan.maturityAt,
            asOf: paidAtDate,
          })
        : null;

    const created = await prisma.$transaction(async (tx) => {
      const txn = await tx.transaction.create({
        data: {
          ...(data.clientId ? { id: data.clientId } : {}),
          workspaceId: ctx.workspaceId,
          type: TransactionType.EXPENSE,
          kind: TransactionKind.LOAN_PAYMENT,
          amount: data.amount,
          description: `Loan payment · ${loan.lenderContact?.name ?? loan.lender}${data.notes ? ` · ${data.notes}` : ""}`,
          date: new Date(data.paidAt),
          accountId: resolvedAccountId,
          cardId: data.cardId ?? null,
          loanId: id,
          userId: ctx.userId,
          createdByUserId: ctx.userId,
        },
      });
      // Persist the split. Until this table existed the principal/interest
      // breakdown was computed here, returned in the response, and thrown
      // away — so reversal had to re-derive the principal with
      // `reverseLoanPaymentPrincipal`, which its own doc comment calls
      // approximate whenever the split was manually overridden. Storing it
      // makes deleting or editing this payment restore the outstanding
      // exactly, and makes "interest actually paid" a recorded fact rather
      // than something three different files each back-derive.
      await tx.loanLedgerEntry.create({
        data: {
          workspaceId: ctx.workspaceId,
          loanId: id,
          kind: LoanLedgerKind.REPAYMENT,
          principalAmount: principalDrop,
          interestAmount: interestPortion,
          gstAmount: gstPortion,
          amount: data.amount,
          paidAt: paidAtDate,
          // The period this payment's interest covers. Without it the next
          // payment has no anchor and would re-accrue from the loan's start.
          periodFrom: anchor,
          periodTo: anchor ? paidAtDate : null,
          transactionId: txn.id,
          notes: data.notes ?? null,
          createdByUserId: ctx.userId,
        },
      });
      await tx.loan.update({
        where: { id },
        data: {
          outstanding: newOutstanding,
          nextDueDate: nextDue,
          ...(newEmi != null ? { emiAmount: newEmi } : {}),
          active: newOutstanding > 0 ? loan.active : false,
          foreclosedAt:
            newOutstanding === 0 && loan.active ? new Date() : loan.foreclosedAt,
        },
      });
      return txn;
    });

    return NextResponse.json({
      ok: true,
      transactionId: created.id,
      outstanding: newOutstanding,
      split: {
        principal: principalDrop,
        interest: interestPortion,
        gst: gstPortion,
      },
      accrual: accrued
        ? {
            anchor: anchor!.toISOString(),
            days: Math.round(accrued.days),
            fraction: accrued.fraction,
          }
        : null,
      emiAmount: newEmi,
    });
  } catch (e) {
    return err(e);
  }
}
