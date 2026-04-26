/*
  Warnings:

  - The `frequency` column on the `Loan` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "LoanFrequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY');

-- AlterTable
ALTER TABLE "Loan" DROP COLUMN "frequency",
ADD COLUMN     "frequency" "LoanFrequency" NOT NULL DEFAULT 'MONTHLY';

-- CreateTable
CREATE TABLE "GoldLoanItem" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "weightGrams" DECIMAL(10,3) NOT NULL,
    "purity" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoldLoanItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GoldLoanItem_loanId_idx" ON "GoldLoanItem"("loanId");

-- AddForeignKey
ALTER TABLE "GoldLoanItem" ADD CONSTRAINT "GoldLoanItem_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
