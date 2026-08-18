-- Move the ornament -> receivable link from a 1:1 column on GoldOrnament
-- to a many-side FK on MemberCharge, so a piece bought for someone can be
-- funded by more than one payment row on the same bill.
--
-- Order matters: the new column is populated from the old one BEFORE the
-- old one is dropped, so no existing link is lost.

-- AlterTable
ALTER TABLE "MemberCharge" ADD COLUMN     "goldOrnamentId" TEXT;

-- Carry existing 1:1 links across.
UPDATE "MemberCharge" mc
SET    "goldOrnamentId" = go."id"
FROM   "GoldOrnament" go
WHERE  go."memberChargeId" = mc."id";

-- CreateIndex
CREATE INDEX "MemberCharge_goldOrnamentId_idx" ON "MemberCharge"("goldOrnamentId");

-- AddForeignKey
ALTER TABLE "MemberCharge" ADD CONSTRAINT "MemberCharge_goldOrnamentId_fkey" FOREIGN KEY ("goldOrnamentId") REFERENCES "GoldOrnament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Now the old side can go.
-- DropForeignKey
ALTER TABLE "GoldOrnament" DROP CONSTRAINT "GoldOrnament_memberChargeId_fkey";

-- DropIndex
DROP INDEX "GoldOrnament_memberChargeId_key";

-- AlterTable
ALTER TABLE "GoldOrnament" DROP COLUMN "memberChargeId";
