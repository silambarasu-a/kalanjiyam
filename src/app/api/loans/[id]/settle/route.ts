import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { canAccessRecord, canModifyRecord } from "@/lib/permissions";
import { loanSettleSchema } from "@/lib/validators-domain";
import { nextInterestDueDate } from "@/lib/hand-loan-interest";
import { counterpartyName } from "@/lib/loan-direction";
import {
  LoanLedgerKind,
  TransactionType,
  TransactionKind,
} from "@/generated/prisma/client";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[loan/settle]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Record an ad-hoc settlement on a hand loan: interest actually paid or
 * received as of a date, an optional partial principal reduction, or both.
 *
 * Works in both directions and derives the cash sign from `Loan.direction` —
 * on a LENT loan the money comes in, on a BORROWED one it goes out.
 *
 * A sibling of /pay rather than a branch inside it: /pay carries the
 * CREDIT_CARD_LOAN statement-cycle math and the "did this cover a full EMI
 * cycle" heuristic, neither of which means anything for an ad-hoc hand loan,
 * and it force-splits the amount by the EMI formula — the exact thing this
 * route exists to avoid. Each route hard-rejects what the other handles, so a
 * mis-wired client can never post half a ledger.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const loan = await prisma.loan.findUnique({
      where: { id },
      include: {
        borrowerContact: { select: { name: true } },
        lenderContact: { select: { name: true } },
      },
    });
    if (!loan) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // Ad-hoc settlement only exists for hand loans, so the feature is fixed —
    // no featureForSource indirection needed.
    const ctx = await requireWorkspace("hand_loans", "write");
    const session = await auth();
    if (loan.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!canModifyRecord(session, loan)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (loan.source !== "HAND_FORMAL") {
      return NextResponse.json(
        { error: "Bank loans and card EMIs are repaid as EMIs." },
        { status: 400 },
      );
    }
    // Same rule and status as PATCH /api/loans/[id]: a closed loan is history.
    if (!loan.active) {
      return NextResponse.json(
        { error: "This loan is closed. Re-open it to record more settlements." },
        { status: 423 },
      );
    }

    const parsed = loanSettleSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const data = parsed.data;

    const isLent = loan.direction === "LENT";
    const interest = round2(data.interestAmount ?? 0);
    const principalDrop = round2(data.principalAmount ?? 0);
    const gross = round2(interest + principalDrop);
    const outstanding = Number(loan.outstanding);

    // Never let a settlement push the balance past zero — that would either
    // hide an overpayment or (on a lent loan) understate the receivable.
    // Mirrors the guard in /api/member-charges/[id]/settle.
    if (principalDrop > outstanding + 0.01) {
      return NextResponse.json(
        {
          error: `Principal exceeds the outstanding (₹${outstanding.toFixed(2)})`,
        },
        { status: 400 },
      );
    }
    const newOutstanding = round2(Math.max(0, outstanding - principalDrop));

    // The account is OPTIONAL: hand loans are routinely settled in cash. With
    // no account we still write the ledger entry — so the interest history and
    // the balance stay correct — but post no Transaction, and therefore move no
    // account balance.
    const accountId = data.accountId ?? null;
    if (accountId) {
      const account = await prisma.account.findUnique({
        where: { id: accountId },
      });
      if (!account || account.workspaceId !== ctx.workspaceId) {
        return NextResponse.json({ error: "Account not found" }, { status: 404 });
      }
      if (!canAccessRecord(session, account)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (account.kind === "CARD") {
        return NextResponse.json(
          { error: "Pick a bank, cash, or wallet account" },
          { status: 400 },
        );
      }
    }

    // The next settlement rolls one cadence past the period this entry covered,
    // falling back to the payment date when the user didn't record a period.
    // Never an EMI cycle — there isn't one.
    const anchor = data.periodTo
      ? new Date(data.periodTo)
      : new Date(data.paidAt);
    // A hand loan can legitimately sit at outstanding 0 with interest still
    // owed, so closing is the user's explicit call. Deliberately NOT mirroring
    // /pay's auto-close on a zero balance.
    const willClose = newOutstanding === 0 && data.closeLoan === true;
    const nextDue = willClose
      ? null
      : nextInterestDueDate(anchor, loan.interestCadence, loan.maturityAt);

    const created = await prisma.$transaction(async (tx) => {
      let txnId: string | null = null;
      if (accountId) {
        const txn = await tx.transaction.create({
          data: {
            ...(data.clientId ? { id: data.clientId } : {}),
            workspaceId: ctx.workspaceId,
            // Never TransactionType.HAND_LOAN — computeAccountBalance only
            // aggregates INCOME / EXPENSE / TRANSFER, so such a row would be
            // invisible to every balance in the app.
            type: isLent ? TransactionType.INCOME : TransactionType.EXPENSE,
            // A pure interest settlement is interest income/expense; once
            // principal moves it's a loan payment, matching how the EMI path
            // tags its rows.
            kind:
              principalDrop > 0
                ? TransactionKind.LOAN_PAYMENT
                : TransactionKind.INTEREST,
            amount: gross,
            description: `Loan ${isLent ? "receipt" : "payment"} · ${counterpartyName(loan)}${
              data.notes ? ` · ${data.notes}` : ""
            }`,
            date: new Date(data.paidAt),
            accountId,
            loanId: id,
            userId: ctx.userId,
            createdByUserId: ctx.userId,
          },
        });
        txnId = txn.id;
      }
      const entry = await tx.loanLedgerEntry.create({
        data: {
          workspaceId: ctx.workspaceId,
          loanId: id,
          kind: LoanLedgerKind.REPAYMENT,
          principalAmount: principalDrop,
          interestAmount: interest,
          amount: gross,
          paidAt: new Date(data.paidAt),
          periodFrom: data.periodFrom ? new Date(data.periodFrom) : null,
          periodTo: data.periodTo ? new Date(data.periodTo) : null,
          transactionId: txnId,
          notes: data.notes ?? null,
          createdByUserId: ctx.userId,
        },
      });
      await tx.loan.update({
        where: { id },
        data: {
          outstanding: newOutstanding,
          nextDueDate: nextDue,
          active: willClose ? false : loan.active,
          foreclosedAt: willClose ? new Date() : loan.foreclosedAt,
        },
      });
      return { entryId: entry.id, txnId };
    });

    return NextResponse.json({
      ok: true,
      entryId: created.entryId,
      transactionId: created.txnId,
      outstanding: newOutstanding,
      closed: willClose,
      split: { principal: principalDrop, interest, gst: 0 },
    });
  } catch (e) {
    return err(e);
  }
}
