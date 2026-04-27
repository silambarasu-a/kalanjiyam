-- DropForeignKey
ALTER TABLE "Transfer" DROP CONSTRAINT "Transfer_toAccountId_fkey";

-- AlterTable
ALTER TABLE "Transfer" ALTER COLUMN "toAccountId" DROP NOT NULL,
ADD COLUMN "toMemberId" TEXT;

-- CreateIndex
CREATE INDEX "Transfer_toMemberId_idx" ON "Transfer"("toMemberId");

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_toAccountId_fkey" FOREIGN KEY ("toAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_toMemberId_fkey" FOREIGN KEY ("toMemberId") REFERENCES "FamilyMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
