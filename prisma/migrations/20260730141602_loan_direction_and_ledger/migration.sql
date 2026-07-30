-- Hand loans in both directions, plus a persisted per-event principal/interest
-- ledger.
--
-- No ordering hazard here: every enum below is CREATE TYPE, and Postgres only
-- forbids using a value in the same transaction that ADDs it to a pre-existing
-- type (see 20260711000000_premium_multiyear_frequencies).
--
-- No data backfill either. The NOT NULL DEFAULTs on Loan.direction /
-- Loan.repaymentMode fill every existing row in place, and BORROWED + EMI is
-- exactly what every pre-existing loan already was. interestCadence stays NULL
-- on them because they are EMI-driven, not cadence-driven.
--
-- LoanLedgerEntry starts empty on purpose: historical payments have no stored
-- split, and synthesising one from reverseLoanPaymentPrincipal would fabricate
-- precision. Every reader falls back to the old derivation when a loan has no
-- entries.

-- CreateEnum
CREATE TYPE "LoanDirection" AS ENUM ('BORROWED', 'LENT');

-- CreateEnum
CREATE TYPE "LoanRepaymentMode" AS ENUM ('EMI', 'AD_HOC');

-- CreateEnum
CREATE TYPE "LoanInterestCadence" AS ENUM ('MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY', 'AT_MATURITY');

-- CreateEnum
CREATE TYPE "LoanLedgerKind" AS ENUM ('DISBURSEMENT', 'REPAYMENT', 'CHARGE', 'WRITE_OFF');

-- AlterTable
ALTER TABLE "Loan" ADD COLUMN     "borrowerContactId" TEXT,
ADD COLUMN     "direction" "LoanDirection" NOT NULL DEFAULT 'BORROWED',
ADD COLUMN     "interestCadence" "LoanInterestCadence",
ADD COLUMN     "repaymentMode" "LoanRepaymentMode" NOT NULL DEFAULT 'EMI';

-- CreateTable
CREATE TABLE "LoanLedgerEntry" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "kind" "LoanLedgerKind" NOT NULL,
    "principalAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "interestAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "gstAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(14,2) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "periodFrom" DATE,
    "periodTo" DATE,
    "transactionId" TEXT,
    "notes" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoanLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LoanLedgerEntry_transactionId_key" ON "LoanLedgerEntry"("transactionId");

-- CreateIndex
CREATE INDEX "LoanLedgerEntry_loanId_paidAt_idx" ON "LoanLedgerEntry"("loanId", "paidAt");

-- CreateIndex
CREATE INDEX "LoanLedgerEntry_workspaceId_kind_paidAt_idx" ON "LoanLedgerEntry"("workspaceId", "kind", "paidAt");

-- CreateIndex
CREATE INDEX "Loan_workspaceId_direction_active_idx" ON "Loan"("workspaceId", "direction", "active");

-- CreateIndex
CREATE INDEX "Loan_workspaceId_borrowerContactId_idx" ON "Loan"("workspaceId", "borrowerContactId");

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_borrowerContactId_fkey" FOREIGN KEY ("borrowerContactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanLedgerEntry" ADD CONSTRAINT "LoanLedgerEntry_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanLedgerEntry" ADD CONSTRAINT "LoanLedgerEntry_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanLedgerEntry" ADD CONSTRAINT "LoanLedgerEntry_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanLedgerEntry" ADD CONSTRAINT "LoanLedgerEntry_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
