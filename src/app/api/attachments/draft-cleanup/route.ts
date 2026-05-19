import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import {
  type AttachmentOwnerKind,
  ATTACHMENT_OWNER_KINDS,
} from "@/lib/attachments";
import { assertOwnerInWorkspace } from "@/lib/attachment-owners";
import { deleteObject, isS3Configured } from "@/lib/s3";

/**
 * Beacon endpoint: hard-delete every Attachment matching the given
 * `(ownerKind, ownerId)` pair, AND the underlying S3 objects.
 *
 * This is hit by `navigator.sendBeacon` when the user refreshes / closes
 * the tab with pending instant-upload drafts. sendBeacon survives the
 * unload event but can't read responses or set custom headers — so this
 * route is auth-checked via the session cookie that the browser
 * automatically attaches.
 *
 * Safety: only deletes when the owner row does NOT exist (genuine
 * drafts). If the parent row was created in the meantime (race), we
 * leave the attachments alone — they're legitimate now.
 */
export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const workspaceId = session.user.activeWorkspaceId;
    if (!workspaceId) {
      return NextResponse.json({ error: "No workspace" }, { status: 403 });
    }

    // sendBeacon sends a Blob/string body. Accept both JSON and text.
    const raw = await request.text();
    let body: { ownerKind?: string; ownerId?: string } = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      body = {};
    }
    const ownerKind = body.ownerKind as AttachmentOwnerKind | undefined;
    const ownerId = body.ownerId;
    if (!ownerKind || !ownerId) {
      return NextResponse.json({ error: "Bad payload" }, { status: 400 });
    }
    if (!ATTACHMENT_OWNER_KINDS.includes(ownerKind)) {
      return NextResponse.json({ error: "Bad ownerKind" }, { status: 400 });
    }

    // If the parent row materialized between the beacon firing and the
    // server handling it, those attachments are now legitimate — leave
    // them alone. Drafts only.
    const ownerExists = await assertOwnerInWorkspace(
      ownerKind,
      ownerId,
      workspaceId,
    );
    if (ownerExists) {
      return NextResponse.json({ ok: true, deleted: 0, skipped: "owner-exists" });
    }

    const rows = await prisma.attachment.findMany({
      where: { workspaceId, ownerKind, ownerId, archivedAt: null },
      select: { id: true, s3Key: true },
    });
    let deleted = 0;
    for (const a of rows) {
      if (isS3Configured()) {
        try {
          await deleteObject(a.s3Key);
        } catch (e) {
          console.warn("[draft-cleanup] S3 delete failed", e);
        }
      }
      await prisma.attachment.delete({ where: { id: a.id } });
      deleted++;
    }
    return NextResponse.json({ ok: true, deleted });
  } catch (e) {
    console.error("[draft-cleanup]", e);
    return NextResponse.json({ error: "Cleanup failed" }, { status: 500 });
  }
}
