-- CreateEnum
CREATE TYPE "WorkspaceRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('INCOME', 'EXPENSE', 'INVESTMENT', 'HAND_LOAN', 'TRANSFER');

-- CreateEnum
CREATE TYPE "TransactionKind" AS ENUM ('SALARY', 'INTEREST', 'AGRI_INCOME', 'LEASE_INCOME', 'OTHER_INCOME', 'HOUSEHOLD', 'GROCERY', 'FARM_DEV', 'WAGE', 'FEED', 'VACCINATION', 'INVESTMENT', 'LOAN_PAYMENT', 'OTHER_EXPENSE');

-- CreateEnum
CREATE TYPE "MemberChargeType" AS ENUM ('NONE', 'RECOVERABLE', 'GIFT');

-- CreateEnum
CREATE TYPE "MemberChargeStatus" AS ENUM ('OUTSTANDING', 'PARTIAL', 'SETTLED', 'WRITTEN_OFF');

-- CreateEnum
CREATE TYPE "AccountKind" AS ENUM ('BANK', 'CASH', 'CARD', 'WALLET');

-- CreateEnum
CREATE TYPE "CardKind" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "CardLimitMode" AS ENUM ('SOLO', 'SHARED');

-- CreateEnum
CREATE TYPE "CardNetwork" AS ENUM ('VISA', 'MASTERCARD', 'RUPAY', 'AMEX', 'DINERS', 'OTHER');

-- CreateEnum
CREATE TYPE "LoanSource" AS ENUM ('BANK', 'HAND_FORMAL', 'CARD_EMI');

-- CreateEnum
CREATE TYPE "LoanKind" AS ENUM ('PERSONAL', 'HOME', 'CAR', 'GOLD', 'BUSINESS', 'EDUCATION', 'OTHER');

-- CreateEnum
CREATE TYPE "HandLoanDirection" AS ENUM ('GIVEN', 'RECEIVED');

-- CreateEnum
CREATE TYPE "HandLoanKind" AS ENUM ('FORMAL', 'INFORMAL');

-- CreateEnum
CREATE TYPE "InvestmentKind" AS ENUM ('STOCK', 'FD', 'MUTUAL_FUND', 'SIP', 'INSURANCE', 'OTHER');

-- CreateEnum
CREATE TYPE "InvestmentAction" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "InsurancePolicyType" AS ENUM ('LIFE', 'HEALTH', 'VEHICLE', 'HOME', 'TRAVEL', 'TERM', 'ULIP', 'ENDOWMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "InsuranceStatus" AS ENUM ('ACTIVE', 'LAPSED', 'MATURED', 'SURRENDERED', 'CLAIMED');

-- CreateEnum
CREATE TYPE "PremiumFrequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY', 'ONE_TIME');

-- CreateEnum
CREATE TYPE "CompoundingFrequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "FDStatus" AS ENUM ('ACTIVE', 'MATURED', 'CLOSED', 'PREMATURE_WITHDRAWAL');

-- CreateEnum
CREATE TYPE "CropStatus" AS ENUM ('PLANNED', 'ACTIVE', 'HARVESTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "LivestockEventType" AS ENUM ('PURCHASE', 'BIRTH', 'DEATH', 'SALE');

-- CreateEnum
CREATE TYPE "LeaseAssetType" AS ENUM ('CROP_BATCH', 'LIVESTOCK_BATCH');

-- CreateEnum
CREATE TYPE "LeaseDirection" AS ENUM ('LEASED_OUT', 'LEASED_IN');

-- CreateEnum
CREATE TYPE "LeaseFrequency" AS ENUM ('ONE_TIME', 'YEARLY', 'CUSTOM_MONTHS');

-- CreateEnum
CREATE TYPE "WageSettlementCadence" AS ENUM ('WEEKLY', 'MONTHLY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "WageSettlementStatus" AS ENUM ('PENDING', 'SETTLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AreaUnit" AS ENUM ('ACRES', 'HECTARES', 'CENTS', 'SQFT', 'SQM');

-- CreateEnum
CREATE TYPE "ReminderKind" AS ENUM ('SIP_BUY', 'FD_INTEREST', 'INSURANCE_PREMIUM', 'LEASE_PAYMENT', 'LOAN_EMI', 'CARD_STATEMENT');

-- CreateEnum
CREATE TYPE "ReminderStatus" AS ENUM ('UPCOMING', 'CONFIRMED', 'SKIPPED', 'MISSED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "passwordHash" TEXT NOT NULL,
    "activeWorkspaceId" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT,
    "ownerUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceMember" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL,
    "permissions" JSONB NOT NULL DEFAULT '{}',
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailVerificationToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerificationToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FamilyMember" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "relationship" TEXT,
    "dob" DATE,
    "userId" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FamilyMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "ownerMemberId" TEXT,
    "sharedWithUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "kind" "AccountKind" NOT NULL,
    "name" TEXT NOT NULL,
    "openingBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "creditLimit" DECIMAL(14,2),
    "statementDate" INTEGER,
    "gracePeriod" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Card" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "ownerMemberId" TEXT,
    "sharedWithUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "name" TEXT NOT NULL,
    "kind" "CardKind" NOT NULL,
    "network" "CardNetwork" NOT NULL DEFAULT 'OTHER',
    "supportsUpi" BOOLEAN NOT NULL DEFAULT false,
    "last4" TEXT,
    "parentAccountId" TEXT,
    "accountId" TEXT,
    "limitMode" "CardLimitMode" NOT NULL DEFAULT 'SOLO',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Card_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardStatement" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "totalDue" DECIMAL(14,2) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transfer" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fromAccountId" TEXT NOT NULL,
    "toAccountId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "statementId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "types" "TransactionType"[],
    "group" TEXT,
    "icon" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "workspaceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "type" "TransactionType" NOT NULL,
    "kind" "TransactionKind",
    "description" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "categoryId" TEXT NOT NULL,
    "accountId" TEXT,
    "cardId" TEXT,
    "workerId" TEXT,
    "cropBatchId" TEXT,
    "livestockBatchId" TEXT,
    "leaseId" TEXT,
    "leaseScheduleId" TEXT,
    "loanId" TEXT,
    "investmentId" TEXT,
    "investmentAction" "InvestmentAction",
    "investmentQty" DECIMAL(14,4),
    "investmentPrice" DECIMAL(14,4),
    "exchangeRate" DECIMAL(10,4),
    "transferId" TEXT,
    "userId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "editedByUserId" TEXT,
    "editedAt" TIMESTAMP(3),
    "editNote" TEXT,
    "beneficiaryMemberId" TEXT,
    "memberChargeType" "MemberChargeType" NOT NULL DEFAULT 'NONE',
    "memberChargeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberCharge" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "beneficiaryMemberId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "settledAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "MemberChargeStatus" NOT NULL DEFAULT 'OUTSTANDING',
    "lastSettlementAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemberCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberChargeSettlement" (
    "id" TEXT NOT NULL,
    "chargeId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "transactionId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberChargeSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Land" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "area" DECIMAL(12,4),
    "areaUnit" "AreaUnit",
    "location" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Land_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Crop" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Crop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CropBatch" (
    "id" TEXT NOT NULL,
    "cropId" TEXT NOT NULL,
    "landId" TEXT,
    "name" TEXT NOT NULL,
    "status" "CropStatus" NOT NULL DEFAULT 'ACTIVE',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "expectedCycleDays" INTEGER,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CropBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Livestock" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "species" TEXT,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Livestock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LivestockBatch" (
    "id" TEXT NOT NULL,
    "livestockId" TEXT NOT NULL,
    "landId" TEXT,
    "name" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "expectedCycleDays" INTEGER,
    "initialCount" INTEGER NOT NULL DEFAULT 0,
    "currentCount" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LivestockBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LivestockEvent" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "eventType" "LivestockEventType" NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL,
    "unitValue" DECIMAL(12,2),
    "notes" TEXT,
    "transactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LivestockEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedLog" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "quantity" DECIMAL(12,4),
    "unit" TEXT,
    "notes" TEXT,
    "transactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaccinationLog" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "vaccine" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "nextDueDate" TIMESTAMP(3),
    "cost" DECIMAL(12,2),
    "notes" TEXT,
    "transactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VaccinationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lease" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "direction" "LeaseDirection" NOT NULL,
    "lessorMemberId" TEXT,
    "lessorName" TEXT,
    "lesseeMemberId" TEXT,
    "lesseeName" TEXT,
    "assetType" "LeaseAssetType" NOT NULL,
    "cropBatchId" TEXT,
    "livestockBatchId" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "frequency" "LeaseFrequency" NOT NULL,
    "customMonths" INTEGER,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "scheduleGenerated" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeasePaymentSchedule" (
    "id" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "dueDate" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" "ReminderStatus" NOT NULL DEFAULT 'UPCOMING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeasePaymentSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Loan" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "sharedWithUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "kind" "LoanKind" NOT NULL,
    "source" "LoanSource" NOT NULL DEFAULT 'BANK',
    "lender" TEXT NOT NULL,
    "borrower" TEXT,
    "principal" DECIMAL(14,2) NOT NULL,
    "outstanding" DECIMAL(14,2) NOT NULL,
    "interestRate" DECIMAL(6,3),
    "gstOnInterest" DECIMAL(6,3),
    "emiAmount" DECIMAL(12,2),
    "tenure" INTEGER,
    "frequency" TEXT DEFAULT 'MONTHLY',
    "charges" DECIMAL(12,2),
    "accountId" TEXT,
    "cardId" TEXT,
    "isExisting" BOOLEAN NOT NULL DEFAULT false,
    "foreclosedAt" TIMESTAMP(3),
    "foreclosureAmt" DECIMAL(14,2),
    "startedAt" TIMESTAMP(3) NOT NULL,
    "maturityAt" TIMESTAMP(3),
    "nextDueDate" TIMESTAMP(3),
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Loan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HandLoanMember" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "familyMemberId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HandLoanMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HandLoanEntry" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "kind" "HandLoanKind" NOT NULL DEFAULT 'INFORMAL',
    "direction" "HandLoanDirection" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "transactionId" TEXT,
    "loanId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HandLoanEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Investment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "sharedWithUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "holderName" TEXT,
    "kind" "InvestmentKind" NOT NULL,
    "name" TEXT NOT NULL,
    "institution" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "currentValue" DECIMAL(14,2),
    "interestRate" DECIMAL(6,3),
    "compoundingFrequency" "CompoundingFrequency",
    "fdStatus" "FDStatus",
    "startedAt" TIMESTAMP(3) NOT NULL,
    "maturityAt" TIMESTAMP(3),
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "symbol" TEXT,
    "quantity" DECIMAL(14,4),
    "purchasePrice" DECIMAL(14,4),
    "dividends" DECIMAL(14,2),
    "exchange" TEXT,
    "currency" TEXT DEFAULT 'INR',
    "policyNumber" TEXT,
    "policyType" "InsurancePolicyType",
    "insuranceStatus" "InsuranceStatus" DEFAULT 'ACTIVE',
    "premiumAmount" DECIMAL(14,2),
    "premiumFrequency" "PremiumFrequency",
    "sumAssured" DECIMAL(14,2),
    "nextDueDate" TIMESTAMP(3),
    "nominee" TEXT,
    "riders" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Investment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvestmentReminder" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "investmentId" TEXT,
    "loanId" TEXT,
    "leaseScheduleId" TEXT,
    "cardStatementId" TEXT,
    "kind" "ReminderKind" NOT NULL,
    "dueDate" DATE NOT NULL,
    "amount" DECIMAL(14,2),
    "status" "ReminderStatus" NOT NULL DEFAULT 'UPCOMING',
    "confirmedTransactionId" TEXT,
    "skippedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvestmentReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Worker" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "dailyRate" DECIMAL(10,2),
    "settlementCadence" "WageSettlementCadence" NOT NULL DEFAULT 'MONTHLY',
    "customCadenceDays" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Worker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "present" BOOLEAN NOT NULL DEFAULT true,
    "dailyRateOverride" DECIMAL(10,2),
    "quantity" DECIMAL(8,2),
    "rate" DECIMAL(10,2),
    "cropBatchId" TEXT,
    "livestockBatchId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WagePayment" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "paidByUserId" TEXT NOT NULL,
    "isBonus" BOOLEAN NOT NULL DEFAULT false,
    "isAdvance" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "transactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WagePayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WageSettlement" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "cadence" "WageSettlementCadence" NOT NULL,
    "earnedAmount" DECIMAL(12,2) NOT NULL,
    "paidAmount" DECIMAL(12,2) NOT NULL,
    "amountDue" DECIMAL(12,2) NOT NULL,
    "status" "WageSettlementStatus" NOT NULL DEFAULT 'PENDING',
    "settledAt" TIMESTAMP(3),
    "settledByUserId" TEXT,
    "snapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WageSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "diff" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");

-- CreateIndex
CREATE INDEX "Workspace_ownerUserId_idx" ON "Workspace"("ownerUserId");

-- CreateIndex
CREATE INDEX "WorkspaceMember_userId_idx" ON "WorkspaceMember"("userId");

-- CreateIndex
CREATE INDEX "WorkspaceMember_workspaceId_role_idx" ON "WorkspaceMember"("workspaceId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceMember_workspaceId_userId_key" ON "WorkspaceMember"("workspaceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailVerificationToken_tokenHash_key" ON "EmailVerificationToken"("tokenHash");

-- CreateIndex
CREATE INDEX "EmailVerificationToken_userId_idx" ON "EmailVerificationToken"("userId");

-- CreateIndex
CREATE INDEX "EmailVerificationToken_expiresAt_idx" ON "EmailVerificationToken"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "FamilyMember_userId_key" ON "FamilyMember"("userId");

-- CreateIndex
CREATE INDEX "FamilyMember_workspaceId_active_idx" ON "FamilyMember"("workspaceId", "active");

-- CreateIndex
CREATE INDEX "Account_workspaceId_active_idx" ON "Account"("workspaceId", "active");

-- CreateIndex
CREATE INDEX "Account_workspaceId_ownerUserId_idx" ON "Account"("workspaceId", "ownerUserId");

-- CreateIndex
CREATE INDEX "Account_workspaceId_ownerMemberId_idx" ON "Account"("workspaceId", "ownerMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "Card_accountId_key" ON "Card"("accountId");

-- CreateIndex
CREATE INDEX "Card_workspaceId_active_idx" ON "Card"("workspaceId", "active");

-- CreateIndex
CREATE INDEX "Card_workspaceId_ownerUserId_idx" ON "Card"("workspaceId", "ownerUserId");

-- CreateIndex
CREATE INDEX "Card_parentAccountId_idx" ON "Card"("parentAccountId");

-- CreateIndex
CREATE INDEX "CardStatement_accountId_periodEnd_idx" ON "CardStatement"("accountId", "periodEnd");

-- CreateIndex
CREATE INDEX "CardStatement_workspaceId_idx" ON "CardStatement"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "CardStatement_accountId_periodStart_key" ON "CardStatement"("accountId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "Transfer_statementId_key" ON "Transfer"("statementId");

-- CreateIndex
CREATE INDEX "Transfer_workspaceId_date_idx" ON "Transfer"("workspaceId", "date");

-- CreateIndex
CREATE INDEX "Transfer_fromAccountId_idx" ON "Transfer"("fromAccountId");

-- CreateIndex
CREATE INDEX "Transfer_toAccountId_idx" ON "Transfer"("toAccountId");

-- CreateIndex
CREATE INDEX "Category_name_idx" ON "Category"("name");

-- CreateIndex
CREATE INDEX "Category_workspaceId_idx" ON "Category"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_leaseScheduleId_key" ON "Transaction"("leaseScheduleId");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_memberChargeId_key" ON "Transaction"("memberChargeId");

-- CreateIndex
CREATE INDEX "Transaction_workspaceId_date_idx" ON "Transaction"("workspaceId", "date");

-- CreateIndex
CREATE INDEX "Transaction_workspaceId_categoryId_idx" ON "Transaction"("workspaceId", "categoryId");

-- CreateIndex
CREATE INDEX "Transaction_workspaceId_accountId_idx" ON "Transaction"("workspaceId", "accountId");

-- CreateIndex
CREATE INDEX "Transaction_cardId_idx" ON "Transaction"("cardId");

-- CreateIndex
CREATE INDEX "Transaction_workerId_idx" ON "Transaction"("workerId");

-- CreateIndex
CREATE INDEX "Transaction_cropBatchId_idx" ON "Transaction"("cropBatchId");

-- CreateIndex
CREATE INDEX "Transaction_livestockBatchId_idx" ON "Transaction"("livestockBatchId");

-- CreateIndex
CREATE INDEX "Transaction_leaseId_idx" ON "Transaction"("leaseId");

-- CreateIndex
CREATE INDEX "Transaction_loanId_idx" ON "Transaction"("loanId");

-- CreateIndex
CREATE INDEX "Transaction_investmentId_idx" ON "Transaction"("investmentId");

-- CreateIndex
CREATE INDEX "Transaction_transferId_idx" ON "Transaction"("transferId");

-- CreateIndex
CREATE INDEX "Transaction_beneficiaryMemberId_idx" ON "Transaction"("beneficiaryMemberId");

-- CreateIndex
CREATE INDEX "MemberCharge_workspaceId_beneficiaryMemberId_status_idx" ON "MemberCharge"("workspaceId", "beneficiaryMemberId", "status");

-- CreateIndex
CREATE INDEX "MemberChargeSettlement_chargeId_paidAt_idx" ON "MemberChargeSettlement"("chargeId", "paidAt");

-- CreateIndex
CREATE INDEX "Land_workspaceId_active_idx" ON "Land"("workspaceId", "active");

-- CreateIndex
CREATE INDEX "Crop_workspaceId_active_idx" ON "Crop"("workspaceId", "active");

-- CreateIndex
CREATE INDEX "CropBatch_cropId_status_idx" ON "CropBatch"("cropId", "status");

-- CreateIndex
CREATE INDEX "CropBatch_landId_idx" ON "CropBatch"("landId");

-- CreateIndex
CREATE INDEX "Livestock_workspaceId_active_idx" ON "Livestock"("workspaceId", "active");

-- CreateIndex
CREATE INDEX "LivestockBatch_livestockId_active_idx" ON "LivestockBatch"("livestockId", "active");

-- CreateIndex
CREATE INDEX "LivestockBatch_landId_idx" ON "LivestockBatch"("landId");

-- CreateIndex
CREATE UNIQUE INDEX "LivestockEvent_transactionId_key" ON "LivestockEvent"("transactionId");

-- CreateIndex
CREATE INDEX "LivestockEvent_batchId_date_idx" ON "LivestockEvent"("batchId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "FeedLog_transactionId_key" ON "FeedLog"("transactionId");

-- CreateIndex
CREATE INDEX "FeedLog_batchId_date_idx" ON "FeedLog"("batchId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "VaccinationLog_transactionId_key" ON "VaccinationLog"("transactionId");

-- CreateIndex
CREATE INDEX "VaccinationLog_batchId_date_idx" ON "VaccinationLog"("batchId", "date");

-- CreateIndex
CREATE INDEX "Lease_workspaceId_active_idx" ON "Lease"("workspaceId", "active");

-- CreateIndex
CREATE INDEX "Lease_cropBatchId_idx" ON "Lease"("cropBatchId");

-- CreateIndex
CREATE INDEX "Lease_livestockBatchId_idx" ON "Lease"("livestockBatchId");

-- CreateIndex
CREATE INDEX "LeasePaymentSchedule_leaseId_dueDate_idx" ON "LeasePaymentSchedule"("leaseId", "dueDate");

-- CreateIndex
CREATE INDEX "LeasePaymentSchedule_status_dueDate_idx" ON "LeasePaymentSchedule"("status", "dueDate");

-- CreateIndex
CREATE INDEX "Loan_workspaceId_active_source_idx" ON "Loan"("workspaceId", "active", "source");

-- CreateIndex
CREATE INDEX "Loan_workspaceId_ownerUserId_idx" ON "Loan"("workspaceId", "ownerUserId");

-- CreateIndex
CREATE INDEX "Loan_cardId_idx" ON "Loan"("cardId");

-- CreateIndex
CREATE INDEX "HandLoanMember_workspaceId_active_idx" ON "HandLoanMember"("workspaceId", "active");

-- CreateIndex
CREATE INDEX "HandLoanMember_email_idx" ON "HandLoanMember"("email");

-- CreateIndex
CREATE UNIQUE INDEX "HandLoanEntry_transactionId_key" ON "HandLoanEntry"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "HandLoanEntry_loanId_key" ON "HandLoanEntry"("loanId");

-- CreateIndex
CREATE INDEX "HandLoanEntry_memberId_date_idx" ON "HandLoanEntry"("memberId", "date");

-- CreateIndex
CREATE INDEX "Investment_workspaceId_kind_active_idx" ON "Investment"("workspaceId", "kind", "active");

-- CreateIndex
CREATE INDEX "Investment_workspaceId_ownerUserId_idx" ON "Investment"("workspaceId", "ownerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "InvestmentReminder_confirmedTransactionId_key" ON "InvestmentReminder"("confirmedTransactionId");

-- CreateIndex
CREATE INDEX "InvestmentReminder_workspaceId_status_dueDate_idx" ON "InvestmentReminder"("workspaceId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "InvestmentReminder_investmentId_idx" ON "InvestmentReminder"("investmentId");

-- CreateIndex
CREATE INDEX "InvestmentReminder_loanId_idx" ON "InvestmentReminder"("loanId");

-- CreateIndex
CREATE INDEX "Worker_workspaceId_active_idx" ON "Worker"("workspaceId", "active");

-- CreateIndex
CREATE INDEX "Attendance_workerId_date_idx" ON "Attendance"("workerId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_workerId_date_key" ON "Attendance"("workerId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "WagePayment_transactionId_key" ON "WagePayment"("transactionId");

-- CreateIndex
CREATE INDEX "WagePayment_workerId_paidAt_idx" ON "WagePayment"("workerId", "paidAt");

-- CreateIndex
CREATE INDEX "WageSettlement_workerId_status_periodEnd_idx" ON "WageSettlement"("workerId", "status", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "WageSettlement_workerId_periodStart_periodEnd_key" ON "WageSettlement"("workerId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "AuditLog_workspaceId_createdAt_idx" ON "AuditLog"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_activeWorkspaceId_fkey" FOREIGN KEY ("activeWorkspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailVerificationToken" ADD CONSTRAINT "EmailVerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilyMember" ADD CONSTRAINT "FamilyMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilyMember" ADD CONSTRAINT "FamilyMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_ownerMemberId_fkey" FOREIGN KEY ("ownerMemberId") REFERENCES "FamilyMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_ownerMemberId_fkey" FOREIGN KEY ("ownerMemberId") REFERENCES "FamilyMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_parentAccountId_fkey" FOREIGN KEY ("parentAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardStatement" ADD CONSTRAINT "CardStatement_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardStatement" ADD CONSTRAINT "CardStatement_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_fromAccountId_fkey" FOREIGN KEY ("fromAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_toAccountId_fkey" FOREIGN KEY ("toAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "CardStatement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_cropBatchId_fkey" FOREIGN KEY ("cropBatchId") REFERENCES "CropBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_livestockBatchId_fkey" FOREIGN KEY ("livestockBatchId") REFERENCES "LivestockBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_leaseScheduleId_fkey" FOREIGN KEY ("leaseScheduleId") REFERENCES "LeasePaymentSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_investmentId_fkey" FOREIGN KEY ("investmentId") REFERENCES "Investment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "Transfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_editedByUserId_fkey" FOREIGN KEY ("editedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_beneficiaryMemberId_fkey" FOREIGN KEY ("beneficiaryMemberId") REFERENCES "FamilyMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_memberChargeId_fkey" FOREIGN KEY ("memberChargeId") REFERENCES "MemberCharge"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberCharge" ADD CONSTRAINT "MemberCharge_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberCharge" ADD CONSTRAINT "MemberCharge_beneficiaryMemberId_fkey" FOREIGN KEY ("beneficiaryMemberId") REFERENCES "FamilyMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberChargeSettlement" ADD CONSTRAINT "MemberChargeSettlement_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "MemberCharge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberChargeSettlement" ADD CONSTRAINT "MemberChargeSettlement_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Land" ADD CONSTRAINT "Land_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Crop" ADD CONSTRAINT "Crop_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CropBatch" ADD CONSTRAINT "CropBatch_cropId_fkey" FOREIGN KEY ("cropId") REFERENCES "Crop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CropBatch" ADD CONSTRAINT "CropBatch_landId_fkey" FOREIGN KEY ("landId") REFERENCES "Land"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Livestock" ADD CONSTRAINT "Livestock_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LivestockBatch" ADD CONSTRAINT "LivestockBatch_livestockId_fkey" FOREIGN KEY ("livestockId") REFERENCES "Livestock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LivestockBatch" ADD CONSTRAINT "LivestockBatch_landId_fkey" FOREIGN KEY ("landId") REFERENCES "Land"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LivestockEvent" ADD CONSTRAINT "LivestockEvent_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "LivestockBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LivestockEvent" ADD CONSTRAINT "LivestockEvent_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedLog" ADD CONSTRAINT "FeedLog_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "LivestockBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedLog" ADD CONSTRAINT "FeedLog_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaccinationLog" ADD CONSTRAINT "VaccinationLog_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "LivestockBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaccinationLog" ADD CONSTRAINT "VaccinationLog_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lease" ADD CONSTRAINT "Lease_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lease" ADD CONSTRAINT "Lease_lessorMemberId_fkey" FOREIGN KEY ("lessorMemberId") REFERENCES "FamilyMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lease" ADD CONSTRAINT "Lease_lesseeMemberId_fkey" FOREIGN KEY ("lesseeMemberId") REFERENCES "FamilyMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lease" ADD CONSTRAINT "Lease_cropBatchId_fkey" FOREIGN KEY ("cropBatchId") REFERENCES "CropBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lease" ADD CONSTRAINT "Lease_livestockBatchId_fkey" FOREIGN KEY ("livestockBatchId") REFERENCES "LivestockBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeasePaymentSchedule" ADD CONSTRAINT "LeasePaymentSchedule_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandLoanMember" ADD CONSTRAINT "HandLoanMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandLoanMember" ADD CONSTRAINT "HandLoanMember_familyMemberId_fkey" FOREIGN KEY ("familyMemberId") REFERENCES "FamilyMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandLoanEntry" ADD CONSTRAINT "HandLoanEntry_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "HandLoanMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandLoanEntry" ADD CONSTRAINT "HandLoanEntry_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandLoanEntry" ADD CONSTRAINT "HandLoanEntry_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandLoanEntry" ADD CONSTRAINT "HandLoanEntry_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Investment" ADD CONSTRAINT "Investment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Investment" ADD CONSTRAINT "Investment_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestmentReminder" ADD CONSTRAINT "InvestmentReminder_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestmentReminder" ADD CONSTRAINT "InvestmentReminder_investmentId_fkey" FOREIGN KEY ("investmentId") REFERENCES "Investment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestmentReminder" ADD CONSTRAINT "InvestmentReminder_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestmentReminder" ADD CONSTRAINT "InvestmentReminder_leaseScheduleId_fkey" FOREIGN KEY ("leaseScheduleId") REFERENCES "LeasePaymentSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestmentReminder" ADD CONSTRAINT "InvestmentReminder_cardStatementId_fkey" FOREIGN KEY ("cardStatementId") REFERENCES "CardStatement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestmentReminder" ADD CONSTRAINT "InvestmentReminder_confirmedTransactionId_fkey" FOREIGN KEY ("confirmedTransactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Worker" ADD CONSTRAINT "Worker_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_cropBatchId_fkey" FOREIGN KEY ("cropBatchId") REFERENCES "CropBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_livestockBatchId_fkey" FOREIGN KEY ("livestockBatchId") REFERENCES "LivestockBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WagePayment" ADD CONSTRAINT "WagePayment_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WagePayment" ADD CONSTRAINT "WagePayment_paidByUserId_fkey" FOREIGN KEY ("paidByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WagePayment" ADD CONSTRAINT "WagePayment_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WageSettlement" ADD CONSTRAINT "WageSettlement_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WageSettlement" ADD CONSTRAINT "WageSettlement_settledByUserId_fkey" FOREIGN KEY ("settledByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
