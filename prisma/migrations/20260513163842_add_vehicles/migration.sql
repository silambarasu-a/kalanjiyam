-- CreateEnum
CREATE TYPE "VehicleKind" AS ENUM ('BIKE', 'CAR', 'TRACTOR', 'TRUCK', 'SCOOTER', 'OTHER');

-- AlterTable
ALTER TABLE "InsuranceClaim" ADD COLUMN     "vehicleId" TEXT;

-- AlterTable
ALTER TABLE "Investment" ADD COLUMN     "vehicleId" TEXT;

-- AlterTable
ALTER TABLE "Loan" ADD COLUMN     "vehicleId" TEXT;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "vehicleId" TEXT;

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ownerContactId" TEXT NOT NULL,
    "kind" "VehicleKind" NOT NULL,
    "name" TEXT NOT NULL,
    "make" TEXT,
    "model" TEXT,
    "year" INTEGER,
    "registrationNo" TEXT,
    "purchaseDate" TIMESTAMP(3),
    "purchasePrice" DECIMAL(14,2),
    "odometerStart" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_registrationNo_key" ON "Vehicle"("registrationNo");

-- CreateIndex
CREATE INDEX "Vehicle_workspaceId_active_idx" ON "Vehicle"("workspaceId", "active");

-- CreateIndex
CREATE INDEX "Vehicle_workspaceId_ownerContactId_idx" ON "Vehicle"("workspaceId", "ownerContactId");

-- CreateIndex
CREATE INDEX "InsuranceClaim_vehicleId_idx" ON "InsuranceClaim"("vehicleId");

-- CreateIndex
CREATE INDEX "Investment_vehicleId_idx" ON "Investment"("vehicleId");

-- CreateIndex
CREATE INDEX "Loan_vehicleId_idx" ON "Loan"("vehicleId");

-- CreateIndex
CREATE INDEX "Transaction_vehicleId_idx" ON "Transaction"("vehicleId");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Investment" ADD CONSTRAINT "Investment_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsuranceClaim" ADD CONSTRAINT "InsuranceClaim_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_ownerContactId_fkey" FOREIGN KEY ("ownerContactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
