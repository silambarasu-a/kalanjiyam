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
import { archiveAttachmentsForOwner } from "@/lib/attachment-archive";

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
    const legacyKey = doc.attachmentKey;
    await prisma.$transaction(async (tx) => {
      await archiveAttachmentsForOwner({
        workspaceId: ctx.workspaceId,
        ownerKind: "VEHICLE_DOCUMENT",
        ownerId: docId,
        userId: ctx.userId,
        tx,
      });
      await tx.vehicleDocument.delete({ where: { id: docId } });
    });
    // Pre-migration legacy column — clean up the inline S3 object too
    // (the new Attachment archival doesn't know about it).
    if (legacyKey && isS3Configured()) {
      try {
        await deleteObject(legacyKey);
      } catch (delErr) {
        console.warn("[vehicles/documents] failed to delete legacy object", delErr);
      }
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}
