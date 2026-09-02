-- CreateTable
CREATE TABLE "GoldTenderRow" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "acquisitionId" TEXT NOT NULL,
    "accountId" TEXT,
    "cardId" TEXT,
    "contactId" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "repay" BOOLEAN NOT NULL DEFAULT true,
    "towardTheirOwn" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoldTenderRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GoldTenderRow_acquisitionId_sortOrder_idx" ON "GoldTenderRow"("acquisitionId", "sortOrder");

-- CreateIndex
CREATE INDEX "GoldTenderRow_workspaceId_idx" ON "GoldTenderRow"("workspaceId");

-- AddForeignKey
ALTER TABLE "GoldTenderRow" ADD CONSTRAINT "GoldTenderRow_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoldTenderRow" ADD CONSTRAINT "GoldTenderRow_acquisitionId_fkey" FOREIGN KEY ("acquisitionId") REFERENCES "GoldAcquisition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoldTenderRow" ADD CONSTRAINT "GoldTenderRow_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoldTenderRow" ADD CONSTRAINT "GoldTenderRow_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoldTenderRow" ADD CONSTRAINT "GoldTenderRow_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
