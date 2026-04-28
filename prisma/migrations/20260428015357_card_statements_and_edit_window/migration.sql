-- Allow many transfers per CardStatement (real bills are often paid in
-- multiple instalments). The previous 1-to-1 unique constraint blocked
-- that.
DROP INDEX "Transfer_statementId_key";
CREATE INDEX "Transfer_statementId_idx" ON "Transfer"("statementId");

-- Configurable edit window for non-card transactions (default 30 days).
ALTER TABLE "Workspace" ADD COLUMN "transactionEditWindowDays" INTEGER NOT NULL DEFAULT 30;
