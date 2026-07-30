/**
 * Direction-aware helpers for loans.
 *
 * A loan can now run either way: BORROWED (you took the money — every loan
 * that existed before `Loan.direction`) or LENT (you gave it out, so
 * `outstanding` is a receivable and every cash sign inverts).
 *
 * The two things that inversion breaks are naming the other party and telling
 * a disbursement apart from a repayment, so both live here and nowhere else.
 */

import { prisma } from "@/lib/prisma";
import type {
  LoanLedgerKind,
  Prisma,
  PrismaClient,
} from "@/generated/prisma/client";

type Tx = PrismaClient | Prisma.TransactionClient;

export type LoanDirection = "BORROWED" | "LENT";

type Nameable = {
  direction?: LoanDirection | string | null;
  lender: string;
  borrower?: string | null;
  lenderContact?: { name: string } | null;
  borrowerContact?: { name: string } | null;
};

/**
 * The other party on a loan, always resolved from the linked Contact when
 * there is one so a rename propagates, falling back to the denormalised
 * strings for legacy / unlinked rows.
 *
 * Use this everywhere a loan is labelled: `loan.lender` alone names the wrong
 * side of a lent loan. (POST/PATCH also copy the borrower's name INTO `lender`
 * for exactly that reason, so the not-yet-migrated label sites still render a
 * sane human — but that's a safety net, not a licence to read `lender`.)
 */
export function counterpartyName(loan: Nameable): string {
  if (loan.direction === "LENT") {
    return loan.borrowerContact?.name ?? loan.borrower ?? loan.lender;
  }
  return loan.lenderContact?.name ?? loan.lender;
}

/** True when the loan's outstanding is a RECEIVABLE, not a liability. */
export function isReceivable(loan: {
  direction?: LoanDirection | string | null;
}): boolean {
  return loan.direction === "LENT";
}

export type LoanLedgerSplit = {
  id: string;
  kind: LoanLedgerKind;
  principalAmount: Prisma.Decimal;
  interestAmount: Prisma.Decimal;
  gstAmount: Prisma.Decimal;
};

export type LoanTxnClass = {
  /** The persisted split, when this transaction has one. */
  entry: LoanLedgerSplit | null;
  /** Created together with the Loan — only the Loan itself may remove it. */
  isDisbursement: boolean;
  /** Money moving back the other way; reversible on its own. */
  isRepayment: boolean;
};

/**
 * Classify a loan-linked transaction.
 *
 * The old inline heuristic — `type === INCOME && kind === LOAN_PAYMENT` means
 * disbursement — INVERTS on a LENT loan, where the disbursement is an EXPENSE
 * and every receipt is an INCOME. Left unfixed, deleting a lent loan's
 * disbursement passes the "can't delete a disbursement" guard and is then
 * processed by the repayment-reversal branch, which ADDS the principal back and
 * doubles the receivable.
 *
 * Reading the ledger entry is direction-proof. The heuristic stays as the
 * fallback for pre-ledger rows, which are all BORROWED and so still classified
 * correctly by it.
 */
export async function classifyLoanTxn(
  txn: { id: string; type: string; kind: string | null },
  tx: Tx = prisma,
): Promise<LoanTxnClass> {
  const entry = await tx.loanLedgerEntry.findUnique({
    where: { transactionId: txn.id },
    select: {
      id: true,
      kind: true,
      principalAmount: true,
      interestAmount: true,
      gstAmount: true,
    },
  });
  if (entry) {
    return {
      entry,
      isDisbursement: entry.kind === "DISBURSEMENT" || entry.kind === "CHARGE",
      isRepayment: entry.kind === "REPAYMENT",
    };
  }
  return {
    entry: null,
    isDisbursement: txn.type === "INCOME" && txn.kind === "LOAN_PAYMENT",
    isRepayment: txn.type === "EXPENSE" && txn.kind === "LOAN_PAYMENT",
  };
}
