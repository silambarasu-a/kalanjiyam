/**
 * One-shot backfill for vehicle-document attachments.
 *
 * Reads every VehicleDocument whose inline `attachmentKey` is populated,
 * creates a matching `Attachment` row pointing at that S3 key, and uses
 * the workspace OWNER as the synthetic `uploadedByUserId` (the legacy
 * inline columns don't record who uploaded the file — workspace owner
 * is the safest default). Idempotent — re-runs skip rows that already
 * have an Attachment with the same s3Key.
 *
 * Run with:
 *   npx tsx prisma/scripts/backfill-vehicle-attachments.ts
 */
import "dotenv/config";
import { prisma } from "../../src/lib/prisma";

async function main() {
  const docs = await prisma.vehicleDocument.findMany({
    where: { attachmentKey: { not: null } },
    select: {
      id: true,
      workspaceId: true,
      attachmentKey: true,
      attachmentFilename: true,
      attachmentMimeType: true,
      attachmentSize: true,
      createdAt: true,
    },
  });
  console.log(`[backfill] scanning ${docs.length} vehicle documents`);

  const workspaceOwners = new Map<string, string>();
  let created = 0;
  let skipped = 0;

  for (const d of docs) {
    if (!d.attachmentKey) continue;
    const existing = await prisma.attachment.findUnique({
      where: { s3Key: d.attachmentKey },
    });
    if (existing) {
      skipped++;
      continue;
    }
    let ownerId = workspaceOwners.get(d.workspaceId);
    if (!ownerId) {
      const ws = await prisma.workspace.findUnique({
        where: { id: d.workspaceId },
        select: { ownerUserId: true },
      });
      if (!ws) {
        console.warn(
          `[backfill] vehicle doc ${d.id} has no workspace; skipping`,
        );
        continue;
      }
      ownerId = ws.ownerUserId;
      workspaceOwners.set(d.workspaceId, ownerId);
    }
    await prisma.attachment.create({
      data: {
        workspaceId: d.workspaceId,
        ownerKind: "VEHICLE_DOCUMENT",
        ownerId: d.id,
        s3Key: d.attachmentKey,
        filename: d.attachmentFilename ?? "(unknown)",
        mimeType: d.attachmentMimeType ?? "application/octet-stream",
        sizeBytes: d.attachmentSize ?? 0,
        uploadedByUserId: ownerId,
        uploadedAt: d.createdAt,
      },
    });
    created++;
  }

  console.log(
    `[backfill] done — created ${created}, skipped ${skipped} (already migrated)`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
