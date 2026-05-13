-- CreateEnum
CREATE TYPE "HospitalizationStage" AS ENUM ('PRE', 'DURING', 'POST');

-- AlterTable
ALTER TABLE "Transaction"
  ADD COLUMN     "hospitalizationId" TEXT,
  ADD COLUMN     "hospitalizationStage" "HospitalizationStage";

-- AlterTable
ALTER TABLE "InsuranceClaim" ADD COLUMN     "hospitalizationId" TEXT;

-- CreateTable
CREATE TABLE "Hospitalization" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "patientContactId" TEXT NOT NULL,
    "hospitalName" TEXT NOT NULL,
    "diagnosis" TEXT,
    "admittedAt" TIMESTAMP(3) NOT NULL,
    "dischargedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Hospitalization_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Hospitalization_workspaceId_admittedAt_idx" ON "Hospitalization"("workspaceId", "admittedAt");

-- CreateIndex
CREATE INDEX "Hospitalization_workspaceId_patientContactId_idx" ON "Hospitalization"("workspaceId", "patientContactId");

-- CreateIndex
CREATE UNIQUE INDEX "InsuranceClaim_hospitalizationId_key" ON "InsuranceClaim"("hospitalizationId");

-- CreateIndex
CREATE INDEX "Transaction_hospitalizationId_idx" ON "Transaction"("hospitalizationId");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_hospitalizationId_fkey" FOREIGN KEY ("hospitalizationId") REFERENCES "Hospitalization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsuranceClaim" ADD CONSTRAINT "InsuranceClaim_hospitalizationId_fkey" FOREIGN KEY ("hospitalizationId") REFERENCES "Hospitalization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hospitalization" ADD CONSTRAINT "Hospitalization_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hospitalization" ADD CONSTRAINT "Hospitalization_patientContactId_fkey" FOREIGN KEY ("patientContactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
