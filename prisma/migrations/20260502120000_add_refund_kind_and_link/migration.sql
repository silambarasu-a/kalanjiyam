-- Refund support: a new TransactionKind value and a self-relation on
-- Transaction so a refund (type=INCOME, kind=REFUND, posted to a card)
-- can optionally point to the original purchase it reverses.

-- Postgres requires ALTER TYPE ADD VALUE outside of a transaction; Prisma
-- runs each migration file in its own implicit transaction, so we use the
-- documented workaround: a separate ALTER TYPE statement.
ALTER TYPE "TransactionKind" ADD VALUE IF NOT EXISTS 'REFUND';

ALTER TABLE "Transaction" ADD COLUMN "refundForTransactionId" TEXT;

ALTER TABLE "Transaction"
  ADD CONSTRAINT "Transaction_refundForTransactionId_fkey"
  FOREIGN KEY ("refundForTransactionId")
  REFERENCES "Transaction"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

CREATE INDEX "Transaction_refundForTransactionId_idx"
  ON "Transaction"("refundForTransactionId");
