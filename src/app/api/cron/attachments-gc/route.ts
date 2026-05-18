import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  type AttachmentOwnerKind,
  ATTACHMENT_OWNER_KINDS,
} from "@/lib/attachments";
import { assertOwnerInWorkspace } from "@/lib/attachment-owners";
import { deleteObject, isS3Configured } from "@/lib/s3";

/**
 * Daily sweep that hard-deletes Attachment rows + S3 objects whose
 * parent row never materialized. Without this, every abandoned
 * create-form leaves orphan S3 objects (and an orphan DB row pointing
 * at them).
 *
 * Runs against the union of all owner kinds — any attachment older than
 * 24h whose parent row no longer exists is removed. 24h is a generous
 * buffer: a user who keeps a form open across a coffee break is fine.
 *
 * Auth identical to /api/cron/notifications: `Bearer $CRON_SECRET`.
 */
const ORPHAN_THRESHOLD_MS = 24 * 60 * 60 * 1000;

function authorize(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const got = request.headers.get("authorization") ?? "";
  return got === `Bearer ${expected}`;
}

export async function POST(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return run();
}

export async function GET(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return run();
}

async function run() {
  const cutoff = new Date(Date.now() - ORPHAN_THRESHOLD_MS);
  const candidates = await prisma.attachment.findMany({
    where: {
      uploadedAt: { lt: cutoff },
      archivedAt: null,
    },
    select: {
      id: true,
      workspaceId: true,
      ownerKind: true,
      ownerId: true,
      s3Key: true,
    },
    take: 5000,
  });

  let deleted = 0;
  let kept = 0;
  let s3Errors = 0;
  for (const att of candidates) {
    if (!ATTACHMENT_OWNER_KINDS.includes(att.ownerKind as AttachmentOwnerKind)) {
      kept++;
      continue;
    }
    const ownerExists = await assertOwnerInWorkspace(
      att.ownerKind as AttachmentOwnerKind,
      att.ownerId,
      att.workspaceId,
    );
    if (ownerExists) {
      kept++;
      continue;
    }
    if (isS3Configured()) {
      try {
        await deleteObject(att.s3Key);
      } catch (e) {
        s3Errors++;
        console.warn("[attachments-gc] S3 delete failed", e);
      }
    }
    await prisma.attachment.delete({ where: { id: att.id } });
    deleted++;
  }

  return NextResponse.json({
    ok: true,
    scanned: candidates.length,
    deleted,
    kept,
    s3Errors,
    cutoff: cutoff.toISOString(),
  });
}
