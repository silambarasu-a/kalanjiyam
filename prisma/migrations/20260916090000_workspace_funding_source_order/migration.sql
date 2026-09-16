-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN "fundingSourceOrder" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
