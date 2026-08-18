-- CreateEnum
CREATE TYPE "GoldAcquisitionKind" AS ENUM ('PURCHASE', 'GIFT_RECEIVED', 'OPENING_STOCK');

-- CreateEnum
CREATE TYPE "GoldOrnamentStatus" AS ENUM ('HELD', 'SOLD', 'GIFTED_OUT');

-- CreateEnum
CREATE TYPE "GoldDisposalKind" AS ENUM ('SOLD', 'GIFTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AttachmentOwnerKind" ADD VALUE 'GOLD_BILL';
ALTER TYPE "AttachmentOwnerKind" ADD VALUE 'GOLD_ORNAMENT';
ALTER TYPE "AttachmentOwnerKind" ADD VALUE 'INVESTMENT_DOCUMENT';

-- CreateTable
CREATE TABLE "GoldAcquisition" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" "GoldAcquisitionKind" NOT NULL DEFAULT 'PURCHASE',
    "investmentId" TEXT,
    "ownerUserId" TEXT,
    "sharedWithUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sellerName" TEXT,
    "billNumber" TEXT,
    "billTotal" DECIMAL(14,2),
    "acquiredAt" TIMESTAMP(3) NOT NULL,
    "giftedByContactId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoldAcquisition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoldOrnament" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "acquisitionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "itemType" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "purity" TEXT,
    "grossWeightGrams" DECIMAL(10,3) NOT NULL,
    "stoneWeightGrams" DECIMAL(10,3) NOT NULL DEFAULT 0,
    "netWeightGrams" DECIMAL(10,3) NOT NULL,
    "ratePerGram" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "wastageAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "wastageInput" TEXT,
    "wastageMode" TEXT DEFAULT 'PERCENT',
    "makingAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "makingInput" TEXT,
    "makingMode" TEXT DEFAULT 'PERCENT',
    "stones" JSONB,
    "cgstAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cgstInput" TEXT,
    "cgstMode" TEXT DEFAULT 'PERCENT',
    "sgstAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sgstInput" TEXT,
    "sgstMode" TEXT DEFAULT 'PERCENT',
    "roundOff" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(14,2) NOT NULL,
    "costBasis" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "declaredValue" DECIMAL(14,2),
    "assignedContactId" TEXT,
    "boughtForContactId" TEXT,
    "memberChargeId" TEXT,
    "status" "GoldOrnamentStatus" NOT NULL DEFAULT 'HELD',
    "disposedAt" TIMESTAMP(3),
    "disposalKind" "GoldDisposalKind",
    "disposalAmount" DECIMAL(14,2),
    "disposalContactId" TEXT,
    "disposalTransactionId" TEXT,
    "realisedGain" DECIMAL(14,2),
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoldOrnament_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GoldAcquisition_investmentId_key" ON "GoldAcquisition"("investmentId");

-- CreateIndex
CREATE INDEX "GoldAcquisition_workspaceId_kind_acquiredAt_idx" ON "GoldAcquisition"("workspaceId", "kind", "acquiredAt");

-- CreateIndex
CREATE INDEX "GoldAcquisition_workspaceId_ownerUserId_idx" ON "GoldAcquisition"("workspaceId", "ownerUserId");

-- CreateIndex
CREATE INDEX "GoldAcquisition_giftedByContactId_idx" ON "GoldAcquisition"("giftedByContactId");

-- CreateIndex
CREATE UNIQUE INDEX "GoldOrnament_memberChargeId_key" ON "GoldOrnament"("memberChargeId");

-- CreateIndex
CREATE UNIQUE INDEX "GoldOrnament_disposalTransactionId_key" ON "GoldOrnament"("disposalTransactionId");

-- CreateIndex
CREATE INDEX "GoldOrnament_workspaceId_status_idx" ON "GoldOrnament"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "GoldOrnament_acquisitionId_sortOrder_idx" ON "GoldOrnament"("acquisitionId", "sortOrder");

-- CreateIndex
CREATE INDEX "GoldOrnament_workspaceId_assignedContactId_idx" ON "GoldOrnament"("workspaceId", "assignedContactId");

-- CreateIndex
CREATE INDEX "GoldOrnament_workspaceId_boughtForContactId_idx" ON "GoldOrnament"("workspaceId", "boughtForContactId");

-- CreateIndex
CREATE INDEX "GoldOrnament_workspaceId_disposalContactId_idx" ON "GoldOrnament"("workspaceId", "disposalContactId");

-- AddForeignKey
ALTER TABLE "GoldAcquisition" ADD CONSTRAINT "GoldAcquisition_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoldAcquisition" ADD CONSTRAINT "GoldAcquisition_investmentId_fkey" FOREIGN KEY ("investmentId") REFERENCES "Investment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoldAcquisition" ADD CONSTRAINT "GoldAcquisition_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoldAcquisition" ADD CONSTRAINT "GoldAcquisition_giftedByContactId_fkey" FOREIGN KEY ("giftedByContactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoldOrnament" ADD CONSTRAINT "GoldOrnament_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoldOrnament" ADD CONSTRAINT "GoldOrnament_acquisitionId_fkey" FOREIGN KEY ("acquisitionId") REFERENCES "GoldAcquisition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoldOrnament" ADD CONSTRAINT "GoldOrnament_assignedContactId_fkey" FOREIGN KEY ("assignedContactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoldOrnament" ADD CONSTRAINT "GoldOrnament_boughtForContactId_fkey" FOREIGN KEY ("boughtForContactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoldOrnament" ADD CONSTRAINT "GoldOrnament_memberChargeId_fkey" FOREIGN KEY ("memberChargeId") REFERENCES "MemberCharge"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoldOrnament" ADD CONSTRAINT "GoldOrnament_disposalContactId_fkey" FOREIGN KEY ("disposalContactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoldOrnament" ADD CONSTRAINT "GoldOrnament_disposalTransactionId_fkey" FOREIGN KEY ("disposalTransactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
