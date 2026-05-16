-- CreateTable
CREATE TABLE "TransactionSplit" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "sharePercent" DECIMAL(6,3),
    "isRecoverable" BOOLEAN NOT NULL DEFAULT false,
    "memberChargeId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransactionSplit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TransactionSplit_memberChargeId_key" ON "TransactionSplit"("memberChargeId");

-- CreateIndex
CREATE INDEX "TransactionSplit_workspaceId_contactId_idx" ON "TransactionSplit"("workspaceId", "contactId");

-- CreateIndex
CREATE INDEX "TransactionSplit_transactionId_idx" ON "TransactionSplit"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "TransactionSplit_transactionId_contactId_key" ON "TransactionSplit"("transactionId", "contactId");

-- AddForeignKey
ALTER TABLE "TransactionSplit" ADD CONSTRAINT "TransactionSplit_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionSplit" ADD CONSTRAINT "TransactionSplit_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionSplit" ADD CONSTRAINT "TransactionSplit_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionSplit" ADD CONSTRAINT "TransactionSplit_memberChargeId_fkey" FOREIGN KEY ("memberChargeId") REFERENCES "MemberCharge"("id") ON DELETE SET NULL ON UPDATE CASCADE;
