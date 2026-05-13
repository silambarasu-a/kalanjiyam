-- CreateEnum
CREATE TYPE "VehicleDisposalKind" AS ENUM ('SOLD', 'EXCHANGED', 'SCRAPPED', 'GIFTED', 'TOTAL_LOSS');

-- AlterTable
ALTER TABLE "Vehicle"
  ADD COLUMN     "disposedAt" TIMESTAMP(3),
  ADD COLUMN     "disposalKind" "VehicleDisposalKind",
  ADD COLUMN     "disposalAmount" DECIMAL(14,2),
  ADD COLUMN     "disposalContactId" TEXT,
  ADD COLUMN     "replacedById" TEXT;

-- CreateIndex
CREATE INDEX "Vehicle_disposalContactId_idx" ON "Vehicle"("disposalContactId");

-- CreateIndex
CREATE INDEX "Vehicle_replacedById_idx" ON "Vehicle"("replacedById");

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_disposalContactId_fkey" FOREIGN KEY ("disposalContactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_replacedById_fkey" FOREIGN KEY ("replacedById") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
