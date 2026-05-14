-- Additive only: add nullable parentCategoryId to Category for the
-- two-level hierarchy (parents → children). No existing column or row
-- is touched. Existing transactions continue to reference the same
-- Category id; only the parent pointer on those Categories changes,
-- and that change is performed by a separate idempotent backfill
-- script (prisma/scripts/backfill-categories-tree.ts), not by this
-- migration.

-- AlterTable
ALTER TABLE "Category" ADD COLUMN "parentCategoryId" TEXT;

-- AddForeignKey: ON DELETE SET NULL — removing a parent never deletes
-- its children; they're left orphaned (parentCategoryId = NULL) so
-- the hierarchy can be re-arranged without data loss.
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentCategoryId_fkey"
  FOREIGN KEY ("parentCategoryId") REFERENCES "Category"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "Category_workspaceId_parentCategoryId_idx"
  ON "Category"("workspaceId", "parentCategoryId");
