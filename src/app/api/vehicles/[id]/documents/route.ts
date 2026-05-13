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
        },
      });
      // Seed a renewal reminder for the expiry date. The cron sweep
      // picks it up at 7 / 3 / 0 days out and emits notifications.
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
