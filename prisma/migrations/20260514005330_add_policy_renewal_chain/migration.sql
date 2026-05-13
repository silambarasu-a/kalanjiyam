-- AlterEnum: add RENEWED status for predecessor rows in a renewal chain.
ALTER TYPE "InsuranceStatus" ADD VALUE 'RENEWED';

-- AlterTable: self-reference to track renewal predecessor.
ALTER TABLE "Investment" ADD COLUMN     "renewedFromInvestmentId" TEXT;

-- CreateIndex
CREATE INDEX "Investment_renewedFromInvestmentId_idx" ON "Investment"("renewedFromInvestmentId");

-- AddForeignKey: SET NULL on predecessor deletion so the successor (the
-- system of record going forward) isn't cascade-deleted with the old row.
ALTER TABLE "Investment" ADD CONSTRAINT "Investment_renewedFromInvestmentId_fkey" FOREIGN KEY ("renewedFromInvestmentId") REFERENCES "Investment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
