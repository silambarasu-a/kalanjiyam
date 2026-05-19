-- CreateEnum
CREATE TYPE "MemberChargeDirection" AS ENUM ('OWED_TO_USER', 'USER_OWES');

-- AlterTable
ALTER TABLE "MemberCharge" ADD COLUMN     "direction" "MemberChargeDirection" NOT NULL DEFAULT 'OWED_TO_USER',
ADD COLUMN     "sourceTransferId" TEXT;

-- AlterTable
ALTER TABLE "Transfer" ADD COLUMN     "createsObligation" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "MemberCharge_workspaceId_direction_status_idx" ON "MemberCharge"("workspaceId", "direction", "status");

-- CreateIndex
CREATE INDEX "MemberCharge_sourceTransferId_idx" ON "MemberCharge"("sourceTransferId");

-- AddForeignKey
ALTER TABLE "MemberCharge" ADD CONSTRAINT "MemberCharge_sourceTransferId_fkey" FOREIGN KEY ("sourceTransferId") REFERENCES "Transfer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
