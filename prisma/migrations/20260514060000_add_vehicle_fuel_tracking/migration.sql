-- Additive only:
--   - New VehicleFuelType enum
--   - New nullable Vehicle.fuelType column
--   - New nullable Transaction.fuelQuantity / fuelUnit / fuelOdometer
-- No existing column or row touched. Legacy data unaffected because
-- every new column is nullable and unused by old code paths.

-- CreateEnum
CREATE TYPE "VehicleFuelType" AS ENUM ('PETROL', 'DIESEL', 'CNG', 'LPG', 'ELECTRIC', 'HYBRID', 'OTHER');

-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN "fuelType" "VehicleFuelType";

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN "fuelQuantity" DECIMAL(10,3);
ALTER TABLE "Transaction" ADD COLUMN "fuelUnit" TEXT;
ALTER TABLE "Transaction" ADD COLUMN "fuelOdometer" INTEGER;
