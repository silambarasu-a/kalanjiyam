-- AlterEnum
ALTER TYPE "WageSettlementCadence" ADD VALUE 'AS_NEEDED';

-- AlterTable
ALTER TABLE "Worker" ALTER COLUMN "settlementCadence" SET DEFAULT 'AS_NEEDED';
