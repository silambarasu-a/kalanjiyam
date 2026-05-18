import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { getAttachmentPolicy, type AttachmentOwnerKind } from "@/lib/attachments";
import { assertOwnerInWorkspace } from "@/lib/attachment-owners";
import { deleteObject, isS3Configured } from "@/lib/s3";

const GRACE_WINDOW_MS = 60_000;

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[attachments/[id]/hard]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

/**
 * Hard-delete an attachment: drops the DB row AND the S3 object. Used
 * by the instant-upload UX, where users expect the file to vanish the
 * moment they click X. Two paths:
 *   1. Draft owner — the parent row was never persisted (form abandon
 *      or pre-submit remove). No history to preserve; always allowed.
 *   2. Saved owner within 60s grace — typo correction. Anything older
 *      must use the soft-archive route so the audit trail survives.
 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const { id } = await context.params;
    const att = await prisma.attachment.findUnique({ where: { id } });
    if (!att) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const policy = getAttachmentPolicy(att.ownerKind as AttachmentOwnerKind);
    const ctx = await requireWorkspace(policy.feature, "write");
    if (att.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const ownerExists = await assertOwnerInWorkspace(
      att.ownerKind as AttachmentOwnerKind,
      att.ownerId,
      ctx.workspaceId,
    );
    const ageMs = Date.now() - att.uploadedAt.getTime();
    const withinGrace = ageMs < GRACE_WINDOW_MS;
    if (ownerExists && !withinGrace) {
      return NextResponse.json(
        {
          error:
            "Hard delete only allowed within 60s of upload — use soft-archive instead",
        },
        { status: 423 },
      );
    }

    if (isS3Configured()) {
      try {
        await deleteObject(att.s3Key);
      } catch (delErr) {
        console.warn("[attachments/hard] failed to delete S3 object", delErr);
      }
    }
    await prisma.attachment.delete({ where: { id } });

    if (policy.sensitive) {
      await prisma.auditLog.create({
        data: {
          workspaceId: ctx.workspaceId,
          userId: ctx.userId,
          action: "attachment.hard_delete",
          entityType: att.ownerKind,
          entityId: att.ownerId,
          diff: { attachmentId: att.id, filename: att.filename },
        },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}
