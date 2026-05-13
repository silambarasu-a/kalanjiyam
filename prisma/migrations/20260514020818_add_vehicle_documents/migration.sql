-- CreateEnum
CREATE TYPE "VehicleDocumentKind" AS ENUM ('RC', 'FC', 'PUC', 'ROAD_TAX', 'INSURANCE_COPY', 'OTHER');

-- AlterEnum
ALTER TYPE "ReminderKind" ADD VALUE 'VEHICLE_DOC_RENEWAL';

-- AlterTable
ALTER TABLE "InvestmentReminder" ADD COLUMN     "vehicleDocumentId" TEXT;

-- CreateTable
CREATE TABLE "VehicleDocument" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "kind" "VehicleDocumentKind" NOT NULL,
    "label" TEXT,
    "number" TEXT,
    "issuedAt" TIMESTAMP(3),
    "expiryAt" TIMESTAMP(3),
    "notes" TEXT,
    "attachmentKey" TEXT,
    "attachmentFilename" TEXT,
    "attachmentMimeType" TEXT,
    "attachmentSize" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InvestmentReminder_vehicleDocumentId_idx" ON "InvestmentReminder"("vehicleDocumentId");

-- CreateIndex
CREATE INDEX "VehicleDocument_workspaceId_expiryAt_idx" ON "VehicleDocument"("workspaceId", "expiryAt");

-- CreateIndex
CREATE INDEX "VehicleDocument_vehicleId_idx" ON "VehicleDocument"("vehicleId");

-- CreateIndex
CREATE INDEX "VehicleDocument_workspaceId_kind_idx" ON "VehicleDocument"("workspaceId", "kind");

-- AddForeignKey
ALTER TABLE "InvestmentReminder" ADD CONSTRAINT "InvestmentReminder_vehicleDocumentId_fkey" FOREIGN KEY ("vehicleDocumentId") REFERENCES "VehicleDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleDocument" ADD CONSTRAINT "VehicleDocument_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleDocument" ADD CONSTRAINT "VehicleDocument_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
