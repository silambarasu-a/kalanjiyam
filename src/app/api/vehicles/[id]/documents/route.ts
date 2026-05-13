import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { vehicleDocumentCreateSchema } from "@/lib/validators-domain";
import {
  ReminderKind,
  ReminderStatus,
  VehicleDocumentKind,
} from "@/generated/prisma/client";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[vehicles/documents]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireWorkspace("vehicles", "read");
    const { id } = await context.params;
    const vehicle = await prisma.vehicle.findUnique({ where: { id } });
    if (!vehicle || vehicle.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const docs = await prisma.vehicleDocument.findMany({
      where: { vehicleId: id },
      orderBy: [{ expiryAt: "asc" }, { createdAt: "desc" }],
    });
    return NextResponse.json({
      documents: docs.map((d) => ({
        id: d.id,
        kind: d.kind,
        label: d.label,
        number: d.number,
        issuedAt: d.issuedAt?.toISOString() ?? null,
        expiryAt: d.expiryAt?.toISOString() ?? null,
        notes: d.notes,
        hasAttachment: !!d.attachmentKey,
        attachmentFilename: d.attachmentFilename,
        attachmentMimeType: d.attachmentMimeType,
        attachmentSize: d.attachmentSize,
      })),
    });
  } catch (e) {
    return err(e);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireWorkspace("vehicles", "write");
    const { id } = await context.params;
    const vehicle = await prisma.vehicle.findUnique({ where: { id } });
    if (!vehicle || vehicle.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const body = await request.json();
    const parsed = vehicleDocumentCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const data = parsed.data;
    // If an attachment key was supplied, verify it belongs to this
    // workspace+vehicle prefix. Prevents a malicious client from
    // attaching another workspace's S3 key to their own doc row.
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

    const created = await prisma.$transaction(async (tx) => {
      const doc = await tx.vehicleDocument.create({
        data: {
          workspaceId: ctx.workspaceId,
          vehicleId: id,
          kind: data.kind as VehicleDocumentKind,
          label: data.label,
          number: data.number,
          issuedAt: data.issuedAt ? new Date(data.issuedAt) : null,
          expiryAt: data.expiryAt ? new Date(data.expiryAt) : null,
          notes: data.notes,
          attachmentKey: data.attachmentKey,
          attachmentFilename: data.attachmentFilename,
          attachmentMimeType: data.attachmentMimeType,
          attachmentSize: data.attachmentSize,
        },
      });
      // Seed a renewal reminder for the expiry date. The cron sweep
      // picks it up at 30 / 14 / 7 / 0 days out and emits notifications.
      if (doc.expiryAt) {
        await tx.investmentReminder.create({
          data: {
            workspaceId: ctx.workspaceId,
            vehicleDocumentId: doc.id,
            kind: ReminderKind.VEHICLE_DOC_RENEWAL,
            dueDate: doc.expiryAt,
            status: ReminderStatus.UPCOMING,
          },
        });
      }
      return doc;
    });
    return NextResponse.json({ id: created.id });
  } catch (e) {
    return err(e);
  }
}
