import { NextResponse } from "next/server";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { attachmentUploadUrlSchema } from "@/lib/validators-domain";
import {
  buildAttachmentKey,
  getAttachmentPolicy,
  isMimeAllowed,
} from "@/lib/attachments";
import { assertOwnerInWorkspace } from "@/lib/attachment-owners";
import { isS3Configured, presignPut, S3ConfigError } from "@/lib/s3";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  if (e instanceof S3ConfigError) {
    return NextResponse.json({ error: e.message }, { status: 503 });
  }
  console.error("[attachments/upload-url]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

/**
 * Returns a presigned S3 PUT URL plus the (server-decided) key the
 * client will echo back to /api/attachments to finalize. The key is
 * built deterministically so the finalize step can re-verify the
 * prefix and refuse if a malicious client substitutes another
 * workspace's key.
 */
export async function POST(request: Request) {
  try {
    if (!isS3Configured()) {
      return NextResponse.json(
        { error: "File uploads are not configured on this server" },
        { status: 503 },
      );
    }
    const body = await request.json();
    const parsed = attachmentUploadUrlSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const { ownerKind, ownerId, filename, contentType, size } = parsed.data;
    const policy = getAttachmentPolicy(ownerKind);
    const ctx = await requireWorkspace(policy.feature, "write");

    // Per-kind MIME / size guard. The schema has a generous 50 MB
    // ceiling; this is the real limit for the specific owner kind.
    if (!isMimeAllowed(ownerKind, contentType)) {
      return NextResponse.json(
        { error: `MIME type "${contentType}" is not allowed for this attachment` },
        { status: 400 },
      );
    }
    if (size > policy.maxMB * 1_000_000) {
      return NextResponse.json(
        { error: `File is too large (limit ${policy.maxMB} MB)` },
        { status: 400 },
      );
    }

    const ownerOk = await assertOwnerInWorkspace(
      ownerKind,
      ownerId,
      ctx.workspaceId,
    );
    if (!ownerOk) {
      return NextResponse.json({ error: "Owner not found" }, { status: 404 });
    }

    const key = buildAttachmentKey({
      ownerKind,
      workspaceId: ctx.workspaceId,
      ownerId,
      filename,
    });
    const url = await presignPut(key, contentType, 600);
    return NextResponse.json({
      url,
      key,
      filename,
      contentType,
      size,
      expiresInSeconds: 600,
    });
  } catch (e) {
    return err(e);
  }
}
