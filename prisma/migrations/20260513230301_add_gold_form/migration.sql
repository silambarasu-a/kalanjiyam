-- CreateEnum
CREATE TYPE "GoldForm" AS ENUM ('ORNAMENT', 'COIN', 'BAR', 'BISCUIT', 'JEWELLERY_MAKING');

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "goldForm" "GoldForm";
