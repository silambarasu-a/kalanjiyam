-- AlterEnum
-- Postgres cannot use a new enum value in the same transaction that adds
-- it, so the enum additions are split from the DML/DDL that reads them.
-- Prisma runs each statement in its own implicit transaction here, and no
-- statement below references these values, so this is safe.
ALTER TYPE "ReminderKind" ADD VALUE 'UTILITY_BILL_EXPECTED';

-- AlterEnum
ALTER TYPE "NotificationKind" ADD VALUE 'UTILITY_BILL_EXPECTED';

-- AlterTable
ALTER TABLE "UtilityProvider" ADD COLUMN "cycleVaries" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "UtilityBill" ADD COLUMN "periodFrom" DATE,
ADD COLUMN "periodTo" DATE;
