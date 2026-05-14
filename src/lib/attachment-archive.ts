import { prisma } from "@/lib/prisma";
import {
  getAttachmentPolicy,
  type AttachmentOwnerKind,
} from "@/lib/attachments";
import { deleteObject, isS3Configured } from "@/lib/s3";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";

type Tx = PrismaClient | Prisma.TransactionClient;

/**
 * Soft-archive every live Attachment row that points at the given
 * `(ownerKind, ownerId)` pair, then best-effort hard-delete the
 * matching S3 objects. Call this from any endpoint that removes a
 * parent row so its files don't orphan.
 *
 *  - Idempotent: rows already archived are skipped.
 *  - Transactional for the DB writes (pass `tx` to bundle with the
 *    parent delete). The S3 cleanup happens after — failures there
 *    only log a warning, never throw.
 *  - Writes a single bundled AuditLog row for sensitive owner kinds
 *    (LOAN_DOCUMENT, INCOME_PROOF). The per-attachment trail is in
 *    the Attachment table itself via `archivedAt / archivedByUserId`.
 */
export async function archiveAttachmentsForOwner(args: {
  workspaceId: string;
  ownerKind: AttachmentOwnerKind;
  ownerId: string;
  /** User performing the action; null when triggered by a system task. */
  userId: string | null;
  tx?: Tx;
}): Promise<{ archived: number; s3Failed: string[] }> {
  const db: Tx = args.tx ?? prisma;

  const live = await db.attachment.findMany({
    where: {
      workspaceId: args.workspaceId,
      ownerKind: args.ownerKind,
      ownerId: args.ownerId,
      archivedAt: null,
    },
    select: { id: true, s3Key: true },
  });
  if (live.length === 0) return { archived: 0, s3Failed: [] };

  await db.attachment.updateMany({
    where: { id: { in: live.map((a) => a.id) } },
    data: {
      archivedAt: new Date(),
      archivedByUserId: args.userId,
    },
  });

  const policy = getAttachmentPolicy(args.ownerKind);
  if (policy.sensitive && args.userId) {
    await db.auditLog.create({
      data: {
        workspaceId: args.workspaceId,
        userId: args.userId,
        action: "attachment.archive.cascade",
        entityType: args.ownerKind,
        entityId: args.ownerId,
        diff: { attachmentIds: live.map((a) => a.id) },
      },
    });
  }

  // S3 cleanup runs OUTSIDE the caller's transaction (we want the DB
  // archive to be durable even when the bucket is unreachable) but
  // INSIDE the request lifecycle — awaited so serverless functions
  // don't terminate before the deletes execute. Failures are logged
  // and tracked but do not throw: the DB archive is already committed,
  // and forcing a request failure here would only leave the user
  // confused about what state their data is in.
  const failedKeys: string[] = [];
  if (isS3Configured() && live.length > 0) {
    const results = await Promise.allSettled(
      live.map((a) => deleteObject(a.s3Key)),
    );
    results.forEach((r, i) => {
      if (r.status === "rejected") {
        failedKeys.push(live[i].s3Key);
        console.warn(
          "[attachment-archive] failed to delete S3 object",
          live[i].s3Key,
          r.reason,
        );
      }
    });
  }

  return { archived: live.length, s3Failed: failedKeys };
}

/**
 * Archive every Attachment for a *list* of owner IDs sharing the same
 * kind. Handy when a parent row's children are deleted by cascade and
 * you want to clean their files before the cascade fires.
 */
export async function archiveAttachmentsForOwners(args: {
  workspaceId: string;
  ownerKind: AttachmentOwnerKind;
  ownerIds: string[];
  userId: string | null;
  tx?: Tx;
}): Promise<{ archived: number; s3Failed: string[] }> {
  if (args.ownerIds.length === 0) return { archived: 0, s3Failed: [] };
  let total = 0;
  const s3Failed: string[] = [];
  for (const ownerId of args.ownerIds) {
    const r = await archiveAttachmentsForOwner({
      workspaceId: args.workspaceId,
      ownerKind: args.ownerKind,
      ownerId,
      userId: args.userId,
      tx: args.tx,
    });
    total += r.archived;
    s3Failed.push(...r.s3Failed);
  }
  return { archived: total, s3Failed };
}
