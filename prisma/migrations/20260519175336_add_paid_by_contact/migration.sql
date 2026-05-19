-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "paidByContactId" TEXT;

-- CreateIndex
CREATE INDEX "Transaction_paidByContactId_idx" ON "Transaction"("paidByContactId");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_paidByContactId_fkey" FOREIGN KEY ("paidByContactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
