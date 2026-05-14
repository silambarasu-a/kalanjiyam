-- Additive only:
--   - New AttachmentOwnerKind enum value
--   - New EventKind enum
--   - New Event table (workspace-scoped, soft-archivable)
--   - New nullable Transaction.eventId column with ON DELETE SET NULL
-- No existing column dropped, renamed, or made NOT NULL. No existing
-- row mutated.

-- AlterEnum (additive only — safe to deploy without downtime)
ALTER TYPE "AttachmentOwnerKind" ADD VALUE 'EVENT_DOCUMENT';

-- CreateEnum
CREATE TYPE "EventKind" AS ENUM ('TRIP', 'FUNCTION', 'FESTIVAL', 'PROJECT', 'MEDICAL', 'OTHER');

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "EventKind" NOT NULL DEFAULT 'TRIP',
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "notes" TEXT,
    "budget" DECIMAL(14,2),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Event_workspaceId_active_idx" ON "Event"("workspaceId", "active");
CREATE INDEX "Event_workspaceId_startedAt_idx" ON "Event"("workspaceId", "startedAt");

-- AddForeignKey: Event → Workspace cascades because deleting a
-- workspace deletes everything inside it.
ALTER TABLE "Event" ADD CONSTRAINT "Event_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable — additive nullable column
ALTER TABLE "Transaction" ADD COLUMN "eventId" TEXT;

-- AddForeignKey: Transaction.eventId → Event.id is ON DELETE SET NULL
-- so deleting an Event NEVER deletes its transactions; they just get
-- untagged. This is the same safety pattern as crop/livestock batches.
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "Transaction_eventId_idx" ON "Transaction"("eventId");
