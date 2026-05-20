-- Phase 1 of the livestock domain rebuild:
--   * New enums (ProductionType, AnimalSex, MortalityCause, WeighingPhase).
--   * LivestockBatch grows production-type + contract + weight target fields.
--   * LivestockEvent grows avg/total weight columns.
--   * New tables: LivestockAnimal, WeighingLog, MortalityLog, LivestockContract.
--   * AttachmentOwnerKind gains LIVESTOCK_BATCH_DOCUMENT so the batch
--     detail page's documents tab can store vet reports / contract scans.

-- 1. Enums ------------------------------------------------------------------

CREATE TYPE "ProductionType" AS ENUM (
  'BROILER_CONTRACT',
  'BROILER_INDEPENDENT',
  'LAYER',
  'COUNTRY_CHICKEN',
  'DAIRY',
  'MEAT_GOAT',
  'MEAT_SHEEP',
  'DUAL_PURPOSE'
);

CREATE TYPE "AnimalSex" AS ENUM ('MALE', 'FEMALE', 'UNKNOWN');

CREATE TYPE "MortalityCause" AS ENUM (
  'UNKNOWN',
  'DISEASE',
  'PREDATOR',
  'INJURY',
  'HEAT',
  'COLD',
  'STAMPEDE',
  'OTHER'
);

CREATE TYPE "WeighingPhase" AS ENUM (
  'ARRIVAL',
  'INTERIM',
  'WEEKLY',
  'EXIT'
);

ALTER TYPE "AttachmentOwnerKind" ADD VALUE 'LIVESTOCK_BATCH_DOCUMENT';

-- 2. LivestockBatch new columns --------------------------------------------

ALTER TABLE "LivestockBatch"
  ADD COLUMN "productionType"   "ProductionType" NOT NULL DEFAULT 'DUAL_PURPOSE',
  ADD COLUMN "contractId"       TEXT,
  ADD COLUMN "initialAvgWeight" DECIMAL(8, 3),
  ADD COLUMN "targetWeight"     DECIMAL(8, 3),
  ADD COLUMN "targetFCR"        DECIMAL(5, 3);

CREATE INDEX "LivestockBatch_contractId_idx"            ON "LivestockBatch"("contractId");
CREATE INDEX "LivestockBatch_productionType_active_idx" ON "LivestockBatch"("productionType", "active");

-- 3. LivestockEvent new columns --------------------------------------------

ALTER TABLE "LivestockEvent"
  ADD COLUMN "avgWeightKg"   DECIMAL(8, 3),
  ADD COLUMN "totalWeightKg" DECIMAL(12, 3);

-- 4. LivestockContract ------------------------------------------------------

CREATE TABLE "LivestockContract" (
  "id"               TEXT             NOT NULL,
  "workspaceId"      TEXT             NOT NULL,
  "contactId"        TEXT,
  "integratorName"   TEXT             NOT NULL,
  "contractRef"      TEXT,
  "agreedRatePerKg"  DECIMAL(10, 2)   NOT NULL,
  "fcrBonusBands"    JSONB,
  "mortalityCap"     DECIMAL(5, 2),
  "mortalityPenalty" JSONB,
  "suppliesProvided" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "notes"            TEXT,
  "startedOn"        TIMESTAMP(3)     NOT NULL,
  "endedOn"          TIMESTAMP(3),
  "createdAt"        TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3)     NOT NULL,

  CONSTRAINT "LivestockContract_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LivestockContract_workspaceId_startedOn_idx" ON "LivestockContract"("workspaceId", "startedOn");
CREATE INDEX "LivestockContract_contactId_idx"             ON "LivestockContract"("contactId");

ALTER TABLE "LivestockContract"
  ADD CONSTRAINT "LivestockContract_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
    ON DELETE CASCADE  ON UPDATE CASCADE;
ALTER TABLE "LivestockContract"
  ADD CONSTRAINT "LivestockContract_contactId_fkey"
    FOREIGN KEY ("contactId") REFERENCES "Contact"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Link LivestockBatch.contractId now that the target exists.
ALTER TABLE "LivestockBatch"
  ADD CONSTRAINT "LivestockBatch_contractId_fkey"
    FOREIGN KEY ("contractId") REFERENCES "LivestockContract"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- 5. LivestockAnimal --------------------------------------------------------

CREATE TABLE "LivestockAnimal" (
  "id"        TEXT         NOT NULL,
  "batchId"   TEXT         NOT NULL,
  "tagNumber" TEXT         NOT NULL,
  "name"      TEXT,
  "sex"       "AnimalSex"  NOT NULL DEFAULT 'UNKNOWN',
  "dob"       TIMESTAMP(3),
  "breed"     TEXT,
  "color"     TEXT,
  "notes"     TEXT,
  "active"    BOOLEAN      NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "LivestockAnimal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LivestockAnimal_batchId_tagNumber_key" ON "LivestockAnimal"("batchId", "tagNumber");
CREATE INDEX "LivestockAnimal_batchId_active_idx"           ON "LivestockAnimal"("batchId", "active");

ALTER TABLE "LivestockAnimal"
  ADD CONSTRAINT "LivestockAnimal_batchId_fkey"
    FOREIGN KEY ("batchId") REFERENCES "LivestockBatch"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- 6. WeighingLog ------------------------------------------------------------

CREATE TABLE "WeighingLog" (
  "id"         TEXT             NOT NULL,
  "batchId"    TEXT             NOT NULL,
  "animalId"   TEXT,
  "phase"      "WeighingPhase"  NOT NULL,
  "date"       TIMESTAMP(3)     NOT NULL,
  "sampleSize" INTEGER          NOT NULL DEFAULT 1,
  "totalKg"    DECIMAL(12, 3)   NOT NULL,
  "avgKg"      DECIMAL(8, 3)    NOT NULL,
  "notes"      TEXT,
  "createdAt"  TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WeighingLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WeighingLog_batchId_date_idx"  ON "WeighingLog"("batchId", "date");
CREATE INDEX "WeighingLog_animalId_date_idx" ON "WeighingLog"("animalId", "date");

ALTER TABLE "WeighingLog"
  ADD CONSTRAINT "WeighingLog_batchId_fkey"
    FOREIGN KEY ("batchId") REFERENCES "LivestockBatch"("id")
    ON DELETE CASCADE  ON UPDATE CASCADE;
ALTER TABLE "WeighingLog"
  ADD CONSTRAINT "WeighingLog_animalId_fkey"
    FOREIGN KEY ("animalId") REFERENCES "LivestockAnimal"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- 7. MortalityLog -----------------------------------------------------------

CREATE TABLE "MortalityLog" (
  "id"        TEXT             NOT NULL,
  "batchId"   TEXT             NOT NULL,
  "animalId"  TEXT,
  "date"      TIMESTAMP(3)     NOT NULL,
  "count"     INTEGER          NOT NULL DEFAULT 1,
  "cause"     "MortalityCause" NOT NULL DEFAULT 'UNKNOWN',
  "culled"    BOOLEAN          NOT NULL DEFAULT FALSE,
  "notes"     TEXT,
  "createdAt" TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MortalityLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MortalityLog_batchId_date_idx"  ON "MortalityLog"("batchId", "date");
CREATE INDEX "MortalityLog_animalId_date_idx" ON "MortalityLog"("animalId", "date");

ALTER TABLE "MortalityLog"
  ADD CONSTRAINT "MortalityLog_batchId_fkey"
    FOREIGN KEY ("batchId") REFERENCES "LivestockBatch"("id")
    ON DELETE CASCADE  ON UPDATE CASCADE;
ALTER TABLE "MortalityLog"
  ADD CONSTRAINT "MortalityLog_animalId_fkey"
    FOREIGN KEY ("animalId") REFERENCES "LivestockAnimal"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
