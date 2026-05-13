import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { vehicleDocumentUpdateSchema } from "@/lib/validators-domain";
import {
  ReminderKind,
  ReminderStatus,
  VehicleDocumentKind,
} from "@/generated/prisma/client";
import { deleteObject, isS3Configured } from "@/lib/s3";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[vehicles/documents/[docId]]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

async function loadDoc(workspaceId: string, vehicleId: string, docId: string) {
  const doc = await prisma.vehicleDocument.findUnique({ where: { id: docId } });
  if (
    !doc ||
    doc.workspaceId !== workspaceId ||
    doc.vehicleId !== vehicleId
  ) {
    return null;
  }
  return doc;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; docId: string }> },
) {
  try {
    const ctx = await requireWorkspace("vehicles", "read");
    const { id, docId } = await context.params;
    const doc = await loadDoc(ctx.workspaceId, id, docId);
    if (!doc) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({
      document: {
        id: doc.id,
        kind: doc.kind,
        label: doc.label,
        number: doc.number,
        issuedAt: doc.issuedAt?.toISOString() ?? null,
        expiryAt: doc.expiryAt?.toISOString() ?? null,
        notes: doc.notes,
        hasAttachment: !!doc.attachmentKey,
        attachmentFilename: doc.attachmentFilename,
        attachmentMimeType: doc.attachmentMimeType,
        attachmentSize: doc.attachmentSize,
      },
    });
  } catch (e) {
    return err(e);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; docId: string }> },
) {
  try {
    const ctx = await requireWorkspace("vehicles", "write");
    const { id, docId } = await context.params;
    const doc = await loadDoc(ctx.workspaceId, id, docId);
    if (!doc) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const body = await request.json();
    const parsed = vehicleDocumentUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const data = parsed.data;
    // If an attachment key is being set / replaced, make sure it lives
    // under this workspace+vehicle prefix.
    if (data.attachmentKey) {
      const expectedPrefix = `workspaces/${ctx.workspaceId}/vehicles/${id}/`;
      const prefix = process.env.AWS_S3_PREFIX
        ? process.env.AWS_S3_PREFIX.replace(/^\/+|\/+$/g, "") + "/"
        : "";
      if (!data.attachmentKey.startsWith(prefix + expectedPrefix)) {
        return NextResponse.json(
          { error: "Attachment key doesn't belong to this vehicle" },
          { status: 400 },
        );
      }
    }

    const oldAttachmentKey = doc.attachmentKey;
    const newExpiryAt =
      data.expiryAt === undefined
        ? doc.expiryAt
        : data.expiryAt
          ? new Date(data.expiryAt)
          : null;
    const expiryChanged =
      (doc.expiryAt?.getTime() ?? null) !== (newExpiryAt?.getTime() ?? null);

    const updated = await prisma.$transaction(async (tx) => {
      const next = await tx.vehicleDocument.update({
        where: { id: docId },
        data: {
          kind: data.kind as VehicleDocumentKind | undefined,
          label: data.label === undefined ? undefined : data.label,
          number: data.number === undefined ? undefined : data.number,
          issuedAt:
            data.issuedAt === undefined
              ? undefined
              : data.issuedAt
                ? new Date(data.issuedAt)
                : null,
          expiryAt:
            data.expiryAt === undefined
              ? undefined
              : data.expiryAt
                ? new Date(data.expiryAt)
                : null,
          notes: data.notes === undefined ? undefined : data.notes,
          attachmentKey:
            data.attachmentKey === undefined ? undefined : data.attachmentKey,
          attachmentFilename:
            data.attachmentFilename === undefined
              ? undefined
              : data.attachmentFilename,
          attachmentMimeType:
            data.attachmentMimeType === undefined
              ? undefined
              : data.attachmentMimeType,
          attachmentSize:
            data.attachmentSize === undefined
              ? undefined
              : data.attachmentSize,
        },
      });

      if (expiryChanged) {
        // Replace future reminders to match the new expiry. Confirmed
        // reminders stay as history.
        await tx.investmentReminder.deleteMany({
          where: {
            vehicleDocumentId: docId,
            status: ReminderStatus.UPCOMING,
          },
        });
        if (next.expiryAt) {
          await tx.investmentReminder.create({
            data: {
              workspaceId: ctx.workspaceId,
              vehicleDocumentId: docId,
              kind: ReminderKind.VEHICLE_DOC_RENEWAL,
              dueDate: next.expiryAt,
              status: ReminderStatus.UPCOMING,
            },
          });
        }
      }
      return next;
    });

    // If a new attachment replaced an old one, delete the old object from
    // S3 so we don't accumulate orphans. Best-effort; ignore errors.
    if (
      data.attachmentKey &&
      oldAttachmentKey &&
      oldAttachmentKey !== data.attachmentKey &&
      isS3Configured()
    ) {
      try {
        await deleteObject(oldAttachmentKey);
      } catch (delErr) {
        console.warn("[vehicles/documents] failed to delete old object", delErr);
      }
    }

    return NextResponse.json({ id: updated.id });
  } catch (e) {
    return err(e);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; docId: string }> },
) {
  try {
    const ctx = await requireWorkspace("vehicles", "write");
    const { id, docId } = await context.params;
    const doc = await loadDoc(ctx.workspaceId, id, docId);
    if (!doc) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const attachmentKey = doc.attachmentKey;
    await prisma.vehicleDocument.delete({ where: { id: docId } });
    if (attachmentKey && isS3Configured()) {
      try {
        await deleteObject(attachmentKey);
      } catch (delErr) {
        console.warn("[vehicles/documents] failed to delete object", delErr);
      }
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}
