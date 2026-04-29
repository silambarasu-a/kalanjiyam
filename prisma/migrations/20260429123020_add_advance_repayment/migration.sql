-- CreateTable
CREATE TABLE "AdvanceRepayment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "receivedByUserId" TEXT NOT NULL,
    "notes" TEXT,
    "idempotencyKey" TEXT,
    "transactionId" TEXT,
    "reversedAt" TIMESTAMP(3),
    "reversedByUserId" TEXT,
    "reversalReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdvanceRepayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdvanceRepayment_transactionId_key" ON "AdvanceRepayment"("transactionId");

-- CreateIndex
CREATE INDEX "AdvanceRepayment_workspaceId_receivedAt_idx" ON "AdvanceRepayment"("workspaceId", "receivedAt");

-- CreateIndex
CREATE INDEX "AdvanceRepayment_workerId_receivedAt_idx" ON "AdvanceRepayment"("workerId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdvanceRepayment_workerId_idempotencyKey_key" ON "AdvanceRepayment"("workerId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "AdvanceRepayment" ADD CONSTRAINT "AdvanceRepayment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdvanceRepayment" ADD CONSTRAINT "AdvanceRepayment_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdvanceRepayment" ADD CONSTRAINT "AdvanceRepayment_receivedByUserId_fkey" FOREIGN KEY ("receivedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdvanceRepayment" ADD CONSTRAINT "AdvanceRepayment_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdvanceRepayment" ADD CONSTRAINT "AdvanceRepayment_reversedByUserId_fkey" FOREIGN KEY ("reversedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Defense-in-depth: amount must be positive at the DB layer.
-- Reversals are encoded as a reversedAt flag, never as a negative amount.
ALTER TABLE "AdvanceRepayment" ADD CONSTRAINT "AdvanceRepayment_amount_positive" CHECK ("amount" > 0);
