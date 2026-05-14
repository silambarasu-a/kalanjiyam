import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import {
  attachmentFinalizeSchema,
  attachmentListQuerySchema,
} from "@/lib/validators-domain";
import {
  attachmentKeyMatchesOwner,
  getAttachmentPolicy,
  isMimeAllowed,
  type AttachmentOwnerKind,
} from "@/lib/attachments";
import { assertOwnerInWorkspace } from "@/lib/attachment-owners";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[attachments]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

/**
 * GET /api/attachments?ownerKind=&ownerId=
 * Returns the active (non-archived) attachments for a single parent
 * row. Workspace-scoped; the owner row is verified in the same query
 * to keep the response 404 when called with a foreign id.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const parsed = attachmentListQuerySchema.safeParse({
      ownerKind: searchParams.get("ownerKind") ?? "",
      ownerId: searchParams.get("ownerId") ?? "",
    });
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const { ownerKind, ownerId } = parsed.data;
    const policy = getAttachmentPolicy(ownerKind);
    const ctx = await requireWorkspace(policy.feature, "read");

    const ownerOk = await assertOwnerInWorkspace(
      ownerKind,
      ownerId,
      ctx.workspaceId,
    );
    if (!ownerOk) {
      return NextResponse.json({ error: "Owner not found" }, { status: 404 });
    }

    const rows = await prisma.attachment.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        ownerKind,
        ownerId,
        archivedAt: null,
      },
      orderBy: { uploadedAt: "desc" },
      include: {
        uploadedBy: { select: { id: true, name: true, email: true } },
      },
    });

    return NextResponse.json({
      attachments: rows.map((a) => ({
        id: a.id,
        filename: a.filename,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
        checksum: a.checksum,
        uploadedAt: a.uploadedAt.toISOString(),
        uploadedBy: a.uploadedBy
          ? { id: a.uploadedBy.id, name: a.uploadedBy.name }
          : null,
      })),
    });
  } catch (e) {
    return err(e);
  }
}

/**
 * POST /api/attachments
 * Finalize step after the client has PUT the object to S3 using the
 * presigned URL from /api/attachments/upload-url. Re-verifies the key
 * prefix matches `(env, workspace, entity, ownerId)` so a malicious
 * client can't claim someone else's S3 object.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = attachmentFinalizeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const data = parsed.data;
    const ownerKind = data.ownerKind as AttachmentOwnerKind;
    const policy = getAttachmentPolicy(ownerKind);
    const ctx = await requireWorkspace(policy.feature, "write");

    if (!isMimeAllowed(ownerKind, data.mimeType)) {
      return NextResponse.json(
        { error: `MIME type "${data.mimeType}" is not allowed` },
        { status: 400 },
      );
    }
    if (data.sizeBytes > policy.maxMB * 1_000_000) {
      return NextResponse.json(
        { error: `File is too large (limit ${policy.maxMB} MB)` },
        { status: 400 },
      );
    }
    if (
      !attachmentKeyMatchesOwner(data.s3Key, {
        ownerKind,
        workspaceId: ctx.workspaceId,
        ownerId: data.ownerId,
      })
    ) {
      return NextResponse.json(
        { error: "Key does not belong to this workspace / owner" },
        { status: 400 },
      );
    }

    const ownerOk = await assertOwnerInWorkspace(
      ownerKind,
      data.ownerId,
      ctx.workspaceId,
    );
    if (!ownerOk) {
      return NextResponse.json({ error: "Owner not found" }, { status: 404 });
    }

    const created = await prisma.attachment.create({
      data: {
        workspaceId: ctx.workspaceId,
        ownerKind,
        ownerId: data.ownerId,
        s3Key: data.s3Key,
        filename: data.filename,
        mimeType: data.mimeType,
        sizeBytes: data.sizeBytes,
        checksum: data.checksum ?? null,
        uploadedByUserId: ctx.userId,
      },
    });

    // Sensitive kinds get an explicit AuditLog row so investigators
    // can answer "who uploaded the loan doc on Tuesday" without
    // walking the Attachment table.
    if (policy.sensitive) {
      await prisma.auditLog.create({
        data: {
          workspaceId: ctx.workspaceId,
          userId: ctx.userId,
          action: "attachment.create",
          entityType: ownerKind,
          entityId: data.ownerId,
          diff: { attachmentId: created.id, filename: data.filename },
        },
      });
    }

    return NextResponse.json({ id: created.id });
  } catch (e) {
    return err(e);
  }
}
