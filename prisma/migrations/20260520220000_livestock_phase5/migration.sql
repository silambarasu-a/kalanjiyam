-- Phase 5: Lift event + Health/disease log + Cron reminders for
-- vaccination-due / cycle-ending.
--   * TransactionKind gains CONTRACT_PAYOUT (broiler-contract integrators
--     lift birds and pay the farmer per kg) and HEALTH_CARE (cost on
--     non-vaccine health logs).
--   * NotificationKind + ReminderKind gain VACCINATION_DUE and
--     LIVESTOCK_CYCLE_ENDING so the existing reminder/notification cron
--     can fire for livestock too.
--   * InvestmentReminder gains nullable FKs to VaccinationLog and
--     LivestockBatch so reminders can point to either.
--   * New HealthLog table: condition, treatment, optional cost +
--     linked Transaction, resolved flag.

ALTER TYPE "TransactionKind" ADD VALUE 'CONTRACT_PAYOUT';
ALTER TYPE "TransactionKind" ADD VALUE 'HEALTH_CARE';
ALTER TYPE "NotificationKind" ADD VALUE 'VACCINATION_DUE';
ALTER TYPE "NotificationKind" ADD VALUE 'LIVESTOCK_CYCLE_ENDING';
ALTER TYPE "ReminderKind" ADD VALUE 'VACCINATION_DUE';
ALTER TYPE "ReminderKind" ADD VALUE 'LIVESTOCK_CYCLE_ENDING';

-- InvestmentReminder: link to vaccination + batch for the new cron paths.
ALTER TABLE "InvestmentReminder"
  ADD COLUMN "vaccinationLogId" TEXT,
  ADD COLUMN "livestockBatchId" TEXT;

CREATE INDEX "InvestmentReminder_vaccinationLogId_idx" ON "InvestmentReminder"("vaccinationLogId");
CREATE INDEX "InvestmentReminder_livestockBatchId_idx" ON "InvestmentReminder"("livestockBatchId");

ALTER TABLE "InvestmentReminder"
  ADD CONSTRAINT "InvestmentReminder_vaccinationLogId_fkey"
    FOREIGN KEY ("vaccinationLogId") REFERENCES "VaccinationLog"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvestmentReminder"
  ADD CONSTRAINT "InvestmentReminder_livestockBatchId_fkey"
    FOREIGN KEY ("livestockBatchId") REFERENCES "LivestockBatch"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- HealthLog ------------------------------------------------------------
CREATE TABLE "HealthLog" (
  "id"            TEXT             NOT NULL,
  "batchId"       TEXT             NOT NULL,
  "animalId"      TEXT,
  "date"          TIMESTAMP(3)     NOT NULL,
  "condition"     TEXT             NOT NULL,
  "treatment"     TEXT,
  "cost"          DECIMAL(12, 2),
  "resolved"      BOOLEAN          NOT NULL DEFAULT FALSE,
  "resolvedAt"    TIMESTAMP(3),
  "transactionId" TEXT,
  "notes"         TEXT,
  "createdAt"     TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "HealthLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HealthLog_transactionId_key"    ON "HealthLog"("transactionId");
CREATE INDEX "HealthLog_batchId_date_idx"            ON "HealthLog"("batchId", "date");
CREATE INDEX "HealthLog_animalId_date_idx"           ON "HealthLog"("animalId", "date");
CREATE INDEX "HealthLog_batchId_resolved_idx"        ON "HealthLog"("batchId", "resolved");

ALTER TABLE "HealthLog"
  ADD CONSTRAINT "HealthLog_batchId_fkey"
    FOREIGN KEY ("batchId") REFERENCES "LivestockBatch"("id")
    ON DELETE CASCADE  ON UPDATE CASCADE;
ALTER TABLE "HealthLog"
  ADD CONSTRAINT "HealthLog_animalId_fkey"
    FOREIGN KEY ("animalId") REFERENCES "LivestockAnimal"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "HealthLog"
  ADD CONSTRAINT "HealthLog_transactionId_fkey"
    FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
