-- Brokerage wallets: a new account kind for cash parked with a broker, with
-- currency conversion on the way in/out of a foreign-currency one, and a
-- link from stock / mutual-fund holdings to the brokerage they sit in.
--
-- Ordering: 'BROKERAGE' is ADDed to a pre-existing enum, and Postgres
-- forbids using such a value in the transaction that adds it. Nothing below
-- uses it — no backfill writes kind = 'BROKERAGE' — so one file is safe
-- (same reasoning as 20260711000000_premium_multiyear_frequencies).
--
-- No data backfill. Every new column is nullable or carries a default that
-- is already true of every existing row: all accounts are INR, no transfer
-- was a conversion, no holding is linked to a brokerage.

-- AlterEnum
ALTER TYPE "AccountKind" ADD VALUE IF NOT EXISTS 'BROKERAGE';

-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'INR',
ADD COLUMN     "openingFxBalance" DECIMAL(14,2),
ADD COLUMN     "dematNumber" TEXT,
ADD COLUMN     "brokerClientId" TEXT;

-- AlterTable
ALTER TABLE "Transfer" ADD COLUMN     "fxCurrency" TEXT,
ADD COLUMN     "fxAmount" DECIMAL(14,2),
ADD COLUMN     "fxRate" DECIMAL(14,6),
ADD COLUMN     "cgst" DECIMAL(12,2),
ADD COLUMN     "sgst" DECIMAL(12,2),
ADD COLUMN     "feeTransactionId" TEXT;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "fxAmount" DECIMAL(14,2);

-- AlterTable
ALTER TABLE "Investment" ADD COLUMN     "brokerageAccountId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Transfer_feeTransactionId_key" ON "Transfer"("feeTransactionId");

-- CreateIndex
CREATE INDEX "Investment_brokerageAccountId_idx" ON "Investment"("brokerageAccountId");

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_feeTransactionId_fkey" FOREIGN KEY ("feeTransactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Investment" ADD CONSTRAINT "Investment_brokerageAccountId_fkey" FOREIGN KEY ("brokerageAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
