import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { getAttachmentPolicy, type AttachmentOwnerKind } from "@/lib/attachments";
import { isS3Configured, presignGet, S3ConfigError } from "@/lib/s3";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  if (e instanceof S3ConfigError) {
    return NextResponse.json({ error: e.message }, { status: 503 });
  }
  console.error("[attachments/[id]/url]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

/**
 * Issue a short-lived presigned GET URL for downloading / viewing the
 * attachment in the browser. The Attachment row is looked up first
 * (so we know the ownerKind), then the workspace's permission for the
 * corresponding feature is checked.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    if (!isS3Configured()) {
      return NextResponse.json(
        { error: "File storage is not configured" },
        { status: 503 },
      );
    }
    const { id } = await context.params;
    const att = await prisma.attachment.findUnique({ where: { id } });
    if (!att) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const policy = getAttachmentPolicy(att.ownerKind as AttachmentOwnerKind);
    const ctx = await requireWorkspace(policy.feature, "read");
    if (att.workspaceId !== ctx.workspaceId || att.archivedAt) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const url = await presignGet(att.s3Key, 300);
    return NextResponse.json({
      url,
      filename: att.filename,
      mimeType: att.mimeType,
      sizeBytes: att.sizeBytes,
      expiresInSeconds: 300,
    });
  } catch (e) {
    return err(e);
  }
}
