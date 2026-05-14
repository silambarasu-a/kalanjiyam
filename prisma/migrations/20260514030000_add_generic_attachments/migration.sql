-- CreateEnum
CREATE TYPE "AttachmentOwnerKind" AS ENUM ('VEHICLE_DOCUMENT', 'INSURANCE_POLICY', 'CARD_STATEMENT', 'TRANSACTION_RECEIPT', 'CROP_BATCH_BILL', 'LOAN_DOCUMENT', 'INCOME_PROOF');

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ownerKind" "AttachmentOwnerKind" NOT NULL,
    "ownerId" TEXT NOT NULL,
    "s3Key" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" TEXT,
    "uploadedByUserId" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),
    "archivedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Attachment_s3Key_key" ON "Attachment"("s3Key");

-- CreateIndex
CREATE INDEX "Attachment_workspaceId_ownerKind_ownerId_archivedAt_idx" ON "Attachment"("workspaceId", "ownerKind", "ownerId", "archivedAt");

-- CreateIndex
CREATE INDEX "Attachment_workspaceId_uploadedByUserId_idx" ON "Attachment"("workspaceId", "uploadedByUserId");

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_archivedByUserId_fkey" FOREIGN KEY ("archivedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
