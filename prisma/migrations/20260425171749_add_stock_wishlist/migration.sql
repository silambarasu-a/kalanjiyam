-- CreateTable
CREATE TABLE "StockWishlist" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "sharedWithUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "symbol" TEXT NOT NULL,
    "name" TEXT,
    "exchange" TEXT,
    "targetPrice" DECIMAL(14,4),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockWishlist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockWishlist_workspaceId_idx" ON "StockWishlist"("workspaceId");

-- CreateIndex
CREATE INDEX "StockWishlist_workspaceId_ownerUserId_idx" ON "StockWishlist"("workspaceId", "ownerUserId");

-- AddForeignKey
ALTER TABLE "StockWishlist" ADD CONSTRAINT "StockWishlist_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockWishlist" ADD CONSTRAINT "StockWishlist_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
