-- Generalize Hospitalization into MedicalRecord: per-person medical history
-- where each record is either an outpatient CHECKUP or a HOSPITALIZATION
-- episode. All renames (no drop/create) so existing rows are preserved;
-- existing rows default to kind = HOSPITALIZATION.

-- CreateEnum
CREATE TYPE "MedicalRecordKind" AS ENUM ('CHECKUP', 'HOSPITALIZATION');

-- Rename table + columns
ALTER TABLE "Hospitalization" RENAME TO "MedicalRecord";
ALTER TABLE "MedicalRecord" RENAME COLUMN "hospitalName" TO "facilityName";
ALTER TABLE "MedicalRecord" RENAME COLUMN "admittedAt" TO "occurredAt";
ALTER TABLE "MedicalRecord" ADD COLUMN "kind" "MedicalRecordKind" NOT NULL DEFAULT 'HOSPITALIZATION';

-- Rename referencing columns
ALTER TABLE "Transaction" RENAME COLUMN "hospitalizationId" TO "medicalRecordId";
ALTER TABLE "InsuranceClaim" RENAME COLUMN "hospitalizationId" TO "medicalRecordId";

-- Rename constraints and indexes to Prisma's conventional names
ALTER TABLE "MedicalRecord" RENAME CONSTRAINT "Hospitalization_pkey" TO "MedicalRecord_pkey";
ALTER TABLE "MedicalRecord" RENAME CONSTRAINT "Hospitalization_workspaceId_fkey" TO "MedicalRecord_workspaceId_fkey";
ALTER TABLE "MedicalRecord" RENAME CONSTRAINT "Hospitalization_patientContactId_fkey" TO "MedicalRecord_patientContactId_fkey";
ALTER TABLE "Transaction" RENAME CONSTRAINT "Transaction_hospitalizationId_fkey" TO "Transaction_medicalRecordId_fkey";
ALTER TABLE "InsuranceClaim" RENAME CONSTRAINT "InsuranceClaim_hospitalizationId_fkey" TO "InsuranceClaim_medicalRecordId_fkey";

ALTER INDEX "Hospitalization_workspaceId_admittedAt_idx" RENAME TO "MedicalRecord_workspaceId_occurredAt_idx";
ALTER INDEX "Hospitalization_workspaceId_patientContactId_idx" RENAME TO "MedicalRecord_workspaceId_patientContactId_idx";
ALTER INDEX "InsuranceClaim_hospitalizationId_key" RENAME TO "InsuranceClaim_medicalRecordId_key";
ALTER INDEX "Transaction_hospitalizationId_idx" RENAME TO "Transaction_medicalRecordId_idx";
