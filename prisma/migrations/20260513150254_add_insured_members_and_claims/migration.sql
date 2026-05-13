-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('FILED', 'INTIMATED', 'UNDER_REVIEW', 'APPROVED', 'PARTIALLY_APPROVED', 'REJECTED', 'PAID', 'CLOSED');

-- AlterTable
ALTER TABLE "InvestmentReminder" ADD COLUMN     "insuredMemberId" TEXT;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "claimId" TEXT;

-- CreateTable
CREATE TABLE "InsuredMember" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "investmentId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "premiumAmount" DECIMAL(14,2),
    "premiumFrequency" "PremiumFrequency",
    "sumAssured" DECIMAL(14,2),
    "coverageStart" TIMESTAMP(3),
    "coverageEnd" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InsuredMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsuranceClaim" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "investmentId" TEXT NOT NULL,
    "insuredMemberId" TEXT,
    "claimNumber" TEXT,
    "incidentDate" TIMESTAMP(3) NOT NULL,
    "filedAt" TIMESTAMP(3),
    "status" "ClaimStatus" NOT NULL DEFAULT 'FILED',
    "claimedAmount" DECIMAL(14,2),
    "approvedAmount" DECIMAL(14,2),
    "receivedAmount" DECIMAL(14,2),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InsuranceClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InsuredMember_workspaceId_active_idx" ON "InsuredMember"("workspaceId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "InsuredMember_investmentId_contactId_key" ON "InsuredMember"("investmentId", "contactId");

-- CreateIndex
CREATE INDEX "InsuranceClaim_workspaceId_status_idx" ON "InsuranceClaim"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "InsuranceClaim_investmentId_idx" ON "InsuranceClaim"("investmentId");

-- CreateIndex
CREATE INDEX "InvestmentReminder_insuredMemberId_idx" ON "InvestmentReminder"("insuredMemberId");

-- CreateIndex
CREATE INDEX "Transaction_claimId_idx" ON "Transaction"("claimId");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "InsuranceClaim"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestmentReminder" ADD CONSTRAINT "InvestmentReminder_insuredMemberId_fkey" FOREIGN KEY ("insuredMemberId") REFERENCES "InsuredMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsuredMember" ADD CONSTRAINT "InsuredMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsuredMember" ADD CONSTRAINT "InsuredMember_investmentId_fkey" FOREIGN KEY ("investmentId") REFERENCES "Investment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsuredMember" ADD CONSTRAINT "InsuredMember_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsuranceClaim" ADD CONSTRAINT "InsuranceClaim_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsuranceClaim" ADD CONSTRAINT "InsuranceClaim_investmentId_fkey" FOREIGN KEY ("investmentId") REFERENCES "Investment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsuranceClaim" ADD CONSTRAINT "InsuranceClaim_insuredMemberId_fkey" FOREIGN KEY ("insuredMemberId") REFERENCES "InsuredMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
