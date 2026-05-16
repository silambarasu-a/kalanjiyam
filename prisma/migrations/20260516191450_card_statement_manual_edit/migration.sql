-- AlterTable
ALTER TABLE "CardStatement" ADD COLUMN     "manuallyEdited" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "manuallyEditedAt" TIMESTAMP(3),
ADD COLUMN     "manuallyEditedById" TEXT;

-- AddForeignKey
ALTER TABLE "CardStatement" ADD CONSTRAINT "CardStatement_manuallyEditedById_fkey" FOREIGN KEY ("manuallyEditedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
