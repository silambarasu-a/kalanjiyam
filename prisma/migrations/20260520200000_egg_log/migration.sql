-- Daily egg production for LAYER + COUNTRY_CHICKEN livestock batches.
-- `grades` is a denormalised Json bag (SMALL / MEDIUM / LARGE / JUMBO /
-- whatever) so the grade taxonomy can evolve without a schema bump.
-- When `sold` and `salePricePerEgg` are both set the API auto-creates
-- a linked INCOME Transaction (kind = EGG_SALE) tagged to the batch.

ALTER TYPE "TransactionKind" ADD VALUE 'EGG_SALE';

CREATE TABLE "EggProductionLog" (
  "id"              TEXT             NOT NULL,
  "batchId"         TEXT             NOT NULL,
  "date"            TIMESTAMP(3)     NOT NULL,
  "collected"       INTEGER          NOT NULL,
  "grades"          JSONB,
  "broken"          INTEGER,
  "sold"            INTEGER,
  "salePricePerEgg" DECIMAL(8, 2),
  "transactionId"   TEXT,
  "notes"           TEXT,
  "createdAt"       TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "EggProductionLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EggProductionLog_transactionId_key" ON "EggProductionLog"("transactionId");
CREATE INDEX "EggProductionLog_batchId_date_idx"        ON "EggProductionLog"("batchId", "date");

ALTER TABLE "EggProductionLog"
  ADD CONSTRAINT "EggProductionLog_batchId_fkey"
    FOREIGN KEY ("batchId") REFERENCES "LivestockBatch"("id")
    ON DELETE CASCADE  ON UPDATE CASCADE;
ALTER TABLE "EggProductionLog"
  ADD CONSTRAINT "EggProductionLog_transactionId_fkey"
    FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
