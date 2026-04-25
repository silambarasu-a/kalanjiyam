-- AlterTable
ALTER TABLE "Card" ADD COLUMN     "parentCardId" TEXT;

-- CreateIndex
CREATE INDEX "Card_parentCardId_idx" ON "Card"("parentCardId");

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_parentCardId_fkey" FOREIGN KEY ("parentCardId") REFERENCES "Card"("id") ON DELETE SET NULL ON UPDATE CASCADE;
