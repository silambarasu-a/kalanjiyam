-- AlterEnum
ALTER TYPE "NotificationKind" ADD VALUE 'UTILITY_RECHARGE_DUE_SOON';

-- AlterEnum
ALTER TYPE "ReminderKind" ADD VALUE 'UTILITY_RECHARGE_DUE';

-- AlterTable
ALTER TABLE "InvestmentReminder" ADD COLUMN     "utilityProviderId" TEXT;

-- AlterTable
ALTER TABLE "UtilityProvider" ADD COLUMN     "prepaid" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rechargeValidityDays" INTEGER,
ADD COLUMN     "validUntil" DATE;

-- CreateIndex
CREATE INDEX "InvestmentReminder_utilityProviderId_idx" ON "InvestmentReminder"("utilityProviderId");

-- CreateIndex
CREATE INDEX "UtilityProvider_prepaid_validUntil_idx" ON "UtilityProvider"("prepaid", "validUntil");

-- AddForeignKey
ALTER TABLE "InvestmentReminder" ADD CONSTRAINT "InvestmentReminder_utilityProviderId_fkey" FOREIGN KEY ("utilityProviderId") REFERENCES "UtilityProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
