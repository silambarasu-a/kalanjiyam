-- AlterTable
ALTER TABLE "MemberCharge" ADD COLUMN     "sourceTransactionId" TEXT;

-- CreateIndex
CREATE INDEX "MemberCharge_sourceTransactionId_idx" ON "MemberCharge"("sourceTransactionId");

-- AddForeignKey
ALTER TABLE "MemberCharge" ADD CONSTRAINT "MemberCharge_sourceTransactionId_fkey" FOREIGN KEY ("sourceTransactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
