import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { getAttachmentPolicy, type AttachmentOwnerKind } from "@/lib/attachments";
import { deleteObject, isS3Configured } from "@/lib/s3";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[attachments/[id]]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

/**
 * Soft-archive the row + best-effort hard-delete the underlying S3
 * object. The DB row stays — that's the audit trail. Re-uploads create
 * a new row (with a new s3Key) rather than reviving the archived one.
 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    // Auth gate FIRST — never reveal attachment-id existence to
    // unauthenticated callers via a 401-vs-404 oracle.
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
    if (att.archivedAt) {
      return NextResponse.json({ ok: true, alreadyArchived: true });
    }

    await prisma.attachment.update({
      where: { id },
      data: {
        archivedAt: new Date(),
        archivedByUserId: ctx.userId,
      },
    });

    if (policy.sensitive) {
      await prisma.auditLog.create({
        data: {
          workspaceId: ctx.workspaceId,
          userId: ctx.userId,
          action: "attachment.delete",
          entityType: att.ownerKind,
          entityId: att.ownerId,
          diff: { attachmentId: att.id, filename: att.filename },
        },
      });
    }

    if (isS3Configured()) {
      try {
        await deleteObject(att.s3Key);
      } catch (delErr) {
        console.warn("[attachments] failed to delete S3 object", delErr);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}
