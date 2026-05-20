-- Daily milk production for DAIRY livestock batches. `sessions` is a
-- denormalised Json bag (morning/evening/etc) so 2-session and 3-session
-- farms share the same shape without a schema bump. When `soldLitres`
-- and `ratePerLitre` are both set the API auto-creates a linked INCOME
-- Transaction (kind = MILK_SALE) tagged to the batch, so dashboard
-- cashflow stays accurate without double-entry.

ALTER TYPE "TransactionKind" ADD VALUE 'MILK_SALE';

CREATE TABLE "MilkLog" (
  "id"            TEXT             NOT NULL,
  "batchId"       TEXT             NOT NULL,
  "animalId"      TEXT,
  "date"          TIMESTAMP(3)     NOT NULL,
  "totalLitres"   DECIMAL(10, 3)   NOT NULL,
  "sessions"      JSONB,
  "fatPct"        DECIMAL(4, 2),
  "snfPct"        DECIMAL(4, 2),
  "soldLitres"    DECIMAL(10, 3),
  "ratePerLitre"  DECIMAL(8, 2),
  "transactionId" TEXT,
  "notes"         TEXT,
  "createdAt"     TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MilkLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MilkLog_transactionId_key" ON "MilkLog"("transactionId");
CREATE INDEX "MilkLog_batchId_date_idx"        ON "MilkLog"("batchId", "date");
CREATE INDEX "MilkLog_animalId_date_idx"       ON "MilkLog"("animalId", "date");

ALTER TABLE "MilkLog"
  ADD CONSTRAINT "MilkLog_batchId_fkey"
    FOREIGN KEY ("batchId") REFERENCES "LivestockBatch"("id")
    ON DELETE CASCADE  ON UPDATE CASCADE;
ALTER TABLE "MilkLog"
  ADD CONSTRAINT "MilkLog_animalId_fkey"
    FOREIGN KEY ("animalId") REFERENCES "LivestockAnimal"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MilkLog"
  ADD CONSTRAINT "MilkLog_transactionId_fkey"
    FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
