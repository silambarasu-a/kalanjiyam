-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SubscriptionCycle" AS ENUM ('WEEKLY', 'MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "UtilityKind" AS ENUM ('ELECTRICITY', 'INTERNET', 'MOBILE_POSTPAID', 'MOBILE_PREPAID', 'DTH', 'GAS', 'WATER', 'OTHER');

-- CreateEnum
CREATE TYPE "UtilityProviderStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AttachmentOwnerKind" ADD VALUE 'UTILITY_BILL';
ALTER TYPE "AttachmentOwnerKind" ADD VALUE 'SUBSCRIPTION_DOCUMENT';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationKind" ADD VALUE 'SUBSCRIPTION_RENEWAL_DUE';
ALTER TYPE "NotificationKind" ADD VALUE 'UTILITY_BILL_DUE_SOON';
ALTER TYPE "NotificationKind" ADD VALUE 'UTILITY_BILL_OVERDUE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ReminderKind" ADD VALUE 'SUBSCRIPTION_RENEWAL';
ALTER TYPE "ReminderKind" ADD VALUE 'UTILITY_BILL_DUE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TransactionKind" ADD VALUE 'SUBSCRIPTION';
ALTER TYPE "TransactionKind" ADD VALUE 'UTILITY_BILL';
ALTER TYPE "TransactionKind" ADD VALUE 'UTILITY_ADVANCE';

-- AlterTable
ALTER TABLE "InvestmentReminder" ADD COLUMN     "subscriptionId" TEXT,
ADD COLUMN     "subscriptionScheduleId" TEXT,
ADD COLUMN     "utilityBillId" TEXT;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "subscriptionId" TEXT,
ADD COLUMN     "subscriptionScheduleId" TEXT,
ADD COLUMN     "utilityBillId" TEXT,
ADD COLUMN     "utilityProviderId" TEXT;

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "sharedWithUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "name" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "cycle" "SubscriptionCycle" NOT NULL,
    "nextBillingDate" DATE NOT NULL,
    "startedOn" DATE NOT NULL,
    "endsOn" DATE,
    "accountId" TEXT,
    "cardId" TEXT,
    "autoPay" BOOLEAN NOT NULL DEFAULT false,
    "categoryId" TEXT,
    "logoUrl" TEXT,
    "notes" TEXT,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionSchedule" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "dueDate" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" "ReminderStatus" NOT NULL DEFAULT 'UPCOMING',
    "skippedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UtilityProvider" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "sharedWithUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "kind" "UtilityKind" NOT NULL,
    "providerName" TEXT NOT NULL,
    "connectionNumber" TEXT,
    "addressLine" TEXT,
    "accountId" TEXT,
    "cardId" TEXT,
    "autoPay" BOOLEAN NOT NULL DEFAULT false,
    "defaultDueDay" INTEGER,
    "advanceBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "UtilityProviderStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UtilityProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UtilityBill" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "billDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "billAmount" DECIMAL(14,2) NOT NULL,
    "previousReading" DECIMAL(12,3),
    "currentReading" DECIMAL(12,3),
    "unitsConsumed" DECIMAL(12,3),
    "advanceApplied" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paidAt" TIMESTAMP(3),
    "paidTransactionId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UtilityBill_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Subscription_workspaceId_status_nextBillingDate_idx" ON "Subscription"("workspaceId", "status", "nextBillingDate");

-- CreateIndex
CREATE INDEX "Subscription_workspaceId_ownerUserId_idx" ON "Subscription"("workspaceId", "ownerUserId");

-- CreateIndex
CREATE INDEX "SubscriptionSchedule_subscriptionId_dueDate_idx" ON "SubscriptionSchedule"("subscriptionId", "dueDate");

-- CreateIndex
CREATE INDEX "SubscriptionSchedule_status_dueDate_idx" ON "SubscriptionSchedule"("status", "dueDate");

-- CreateIndex
CREATE INDEX "UtilityProvider_workspaceId_status_kind_idx" ON "UtilityProvider"("workspaceId", "status", "kind");

-- CreateIndex
CREATE INDEX "UtilityProvider_workspaceId_ownerUserId_idx" ON "UtilityProvider"("workspaceId", "ownerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "UtilityProvider_workspaceId_kind_providerName_connectionNum_key" ON "UtilityProvider"("workspaceId", "kind", "providerName", "connectionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "UtilityBill_paidTransactionId_key" ON "UtilityBill"("paidTransactionId");

-- CreateIndex
CREATE INDEX "UtilityBill_providerId_billDate_idx" ON "UtilityBill"("providerId", "billDate");

-- CreateIndex
CREATE INDEX "UtilityBill_workspaceId_paidAt_idx" ON "UtilityBill"("workspaceId", "paidAt");

-- CreateIndex
CREATE INDEX "UtilityBill_workspaceId_dueDate_idx" ON "UtilityBill"("workspaceId", "dueDate");

-- CreateIndex
CREATE INDEX "InvestmentReminder_subscriptionId_idx" ON "InvestmentReminder"("subscriptionId");

-- CreateIndex
CREATE INDEX "InvestmentReminder_subscriptionScheduleId_idx" ON "InvestmentReminder"("subscriptionScheduleId");

-- CreateIndex
CREATE INDEX "InvestmentReminder_utilityBillId_idx" ON "InvestmentReminder"("utilityBillId");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_subscriptionScheduleId_key" ON "Transaction"("subscriptionScheduleId");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_utilityBillId_key" ON "Transaction"("utilityBillId");

-- CreateIndex
CREATE INDEX "Transaction_subscriptionId_idx" ON "Transaction"("subscriptionId");

-- CreateIndex
CREATE INDEX "Transaction_utilityProviderId_idx" ON "Transaction"("utilityProviderId");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_subscriptionScheduleId_fkey" FOREIGN KEY ("subscriptionScheduleId") REFERENCES "SubscriptionSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_utilityProviderId_fkey" FOREIGN KEY ("utilityProviderId") REFERENCES "UtilityProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_utilityBillId_fkey" FOREIGN KEY ("utilityBillId") REFERENCES "UtilityBill"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionSchedule" ADD CONSTRAINT "SubscriptionSchedule_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UtilityProvider" ADD CONSTRAINT "UtilityProvider_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UtilityProvider" ADD CONSTRAINT "UtilityProvider_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UtilityProvider" ADD CONSTRAINT "UtilityProvider_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UtilityProvider" ADD CONSTRAINT "UtilityProvider_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UtilityBill" ADD CONSTRAINT "UtilityBill_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UtilityBill" ADD CONSTRAINT "UtilityBill_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "UtilityProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestmentReminder" ADD CONSTRAINT "InvestmentReminder_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestmentReminder" ADD CONSTRAINT "InvestmentReminder_subscriptionScheduleId_fkey" FOREIGN KEY ("subscriptionScheduleId") REFERENCES "SubscriptionSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestmentReminder" ADD CONSTRAINT "InvestmentReminder_utilityBillId_fkey" FOREIGN KEY ("utilityBillId") REFERENCES "UtilityBill"("id") ON DELETE CASCADE ON UPDATE CASCADE;
