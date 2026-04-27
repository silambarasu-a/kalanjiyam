-- Drop the informal HandLoan system. Transfers now cover person-to-person
-- one-shot money movement; formal hand loans live on Loan.source=HAND_FORMAL.

-- DropForeignKey
ALTER TABLE "HandLoanEntry" DROP CONSTRAINT "HandLoanEntry_memberId_fkey";

-- DropForeignKey
ALTER TABLE "HandLoanEntry" DROP CONSTRAINT "HandLoanEntry_transactionId_fkey";

-- DropForeignKey
ALTER TABLE "HandLoanEntry" DROP CONSTRAINT "HandLoanEntry_loanId_fkey";

-- DropForeignKey
ALTER TABLE "HandLoanEntry" DROP CONSTRAINT "HandLoanEntry_createdByUserId_fkey";

-- DropForeignKey
ALTER TABLE "HandLoanMember" DROP CONSTRAINT "HandLoanMember_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "HandLoanMember" DROP CONSTRAINT "HandLoanMember_familyMemberId_fkey";

-- DropTable
DROP TABLE "HandLoanEntry";

-- DropTable
DROP TABLE "HandLoanMember";

-- DropEnum
DROP TYPE "HandLoanDirection";

-- DropEnum
DROP TYPE "HandLoanKind";

-- Add inflow direction to Transfer (Part 2): make fromAccountId nullable and
-- add fromMemberId so the source can be a family member sending money in.

-- DropForeignKey
ALTER TABLE "Transfer" DROP CONSTRAINT "Transfer_fromAccountId_fkey";

-- AlterTable
ALTER TABLE "Transfer" ALTER COLUMN "fromAccountId" DROP NOT NULL,
ADD COLUMN "fromMemberId" TEXT;

-- CreateIndex
CREATE INDEX "Transfer_fromMemberId_idx" ON "Transfer"("fromMemberId");

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_fromAccountId_fkey" FOREIGN KEY ("fromAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_fromMemberId_fkey" FOREIGN KEY ("fromMemberId") REFERENCES "FamilyMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
