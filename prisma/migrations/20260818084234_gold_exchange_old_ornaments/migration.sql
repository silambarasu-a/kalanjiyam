-- AlterEnum
ALTER TYPE "GoldDisposalKind" ADD VALUE 'EXCHANGED';

-- AlterEnum
ALTER TYPE "GoldOrnamentStatus" ADD VALUE 'EXCHANGED';

-- CreateTable
CREATE TABLE "GoldExchangeItem" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "acquisitionId" TEXT NOT NULL,
    "ornamentId" TEXT,
    "name" TEXT NOT NULL,
    "grossWeightGrams" DECIMAL(10,3) NOT NULL,
    "purity" TEXT,
    "ratePerGram" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "deductionPercent" DECIMAL(6,3),
    "creditAmount" DECIMAL(14,2) NOT NULL,
    "assumedCostBasis" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoldExchangeItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GoldExchangeItem_ornamentId_key" ON "GoldExchangeItem"("ornamentId");

-- CreateIndex
CREATE INDEX "GoldExchangeItem_workspaceId_idx" ON "GoldExchangeItem"("workspaceId");

-- CreateIndex
CREATE INDEX "GoldExchangeItem_acquisitionId_sortOrder_idx" ON "GoldExchangeItem"("acquisitionId", "sortOrder");

-- AddForeignKey
ALTER TABLE "GoldExchangeItem" ADD CONSTRAINT "GoldExchangeItem_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoldExchangeItem" ADD CONSTRAINT "GoldExchangeItem_acquisitionId_fkey" FOREIGN KEY ("acquisitionId") REFERENCES "GoldAcquisition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoldExchangeItem" ADD CONSTRAINT "GoldExchangeItem_ornamentId_fkey" FOREIGN KEY ("ornamentId") REFERENCES "GoldOrnament"("id") ON DELETE SET NULL ON UPDATE CASCADE;
