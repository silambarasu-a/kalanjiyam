import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  requireWorkspace,
  WorkspaceAccessError,
  assertWorkspaceContact,
} from "@/lib/workspace";
import { medicalRecordCreateSchema } from "@/lib/validators-domain";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[medical-records]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const ctx = await requireWorkspace("medical", "read");
    const url = new URL(request.url);
    const patientContactId = url.searchParams.get("patientContactId");

    const rows = await prisma.medicalRecord.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        ...(patientContactId ? { patientContactId } : {}),
      },
      orderBy: { occurredAt: "desc" },
      include: {
        patientContact: { select: { id: true, name: true, relationship: true } },
        claim: { select: { id: true, claimNumber: true, status: true } },
        _count: {
          select: {
            transactions: { where: { workspaceId: ctx.workspaceId } },
          },
        },
      },
    });
    return NextResponse.json({
      records: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        facilityName: r.facilityName,
        diagnosis: r.diagnosis,
        occurredAt: r.occurredAt.toISOString(),
        dischargedAt: r.dischargedAt?.toISOString() ?? null,
        notes: r.notes,
        patientContact: r.patientContact,
        claim: r.claim,
        transactionCount: r._count.transactions,
      })),
    });
  } catch (e) {
    return err(e);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireWorkspace("medical", "write");
    const body = await request.json();
    const parsed = medicalRecordCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const data = parsed.data;
    await assertWorkspaceContact(ctx.workspaceId, data.patientContactId);
    const record = await prisma.medicalRecord.create({
      data: {
        workspaceId: ctx.workspaceId,
        patientContactId: data.patientContactId,
        kind: data.kind,
        facilityName: data.facilityName,
        diagnosis: data.diagnosis,
        occurredAt: new Date(data.occurredAt),
        // Discharge only exists for hospitalization episodes.
        dischargedAt:
          data.kind === "HOSPITALIZATION" && data.dischargedAt
            ? new Date(data.dischargedAt)
            : null,
        notes: data.notes,
      },
    });
    return NextResponse.json({ id: record.id });
  } catch (e) {
    return err(e);
  }
}
