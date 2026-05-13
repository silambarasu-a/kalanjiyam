-- CreateEnum
CREATE TYPE "InsuredMemberRole" AS ENUM ('INSURED', 'BENEFICIARY');

-- AlterTable
ALTER TABLE "Investment"
  ADD COLUMN     "policyTermYears" INTEGER,
  ADD COLUMN     "premiumPayingTermYears" INTEGER,
  ADD COLUMN     "maturityValue" DECIMAL(14,2),
  ADD COLUMN     "bonusAccrued" DECIMAL(14,2),
  ADD COLUMN     "bonusLastRevisedAt" TIMESTAMP(3),
  ADD COLUMN     "ridersJson" JSONB;

-- AlterTable
ALTER TABLE "InsuredMember"
  ADD COLUMN     "role" "InsuredMemberRole" NOT NULL DEFAULT 'INSURED',
  ADD COLUMN     "sharePercent" DECIMAL(5,2);
