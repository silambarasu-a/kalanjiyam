import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  requireWorkspace,
  WorkspaceAccessError,
  assertWorkspaceContact,
} from "@/lib/workspace";
import { hospitalizationCreateSchema } from "@/lib/validators-domain";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[hospitalizations]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const ctx = await requireWorkspace("medical", "read");
    const url = new URL(request.url);
    const patientContactId = url.searchParams.get("patientContactId");

    const rows = await prisma.hospitalization.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        ...(patientContactId ? { patientContactId } : {}),
      },
      orderBy: { admittedAt: "desc" },
      include: {
        patientContact: { select: { id: true, name: true } },
        claim: { select: { id: true, claimNumber: true, status: true } },
        _count: { select: { transactions: true } },
      },
    });
    return NextResponse.json({
      hospitalizations: rows.map((h) => ({
        id: h.id,
        hospitalName: h.hospitalName,
        diagnosis: h.diagnosis,
        admittedAt: h.admittedAt.toISOString(),
        dischargedAt: h.dischargedAt?.toISOString() ?? null,
        notes: h.notes,
        patientContact: h.patientContact,
        claim: h.claim,
        transactionCount: h._count.transactions,
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
    const parsed = hospitalizationCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const data = parsed.data;
    await assertWorkspaceContact(ctx.workspaceId, data.patientContactId);
    const h = await prisma.hospitalization.create({
      data: {
        workspaceId: ctx.workspaceId,
        patientContactId: data.patientContactId,
        hospitalName: data.hospitalName,
        diagnosis: data.diagnosis,
        admittedAt: new Date(data.admittedAt),
        dischargedAt: data.dischargedAt ? new Date(data.dischargedAt) : null,
        notes: data.notes,
      },
    });
    return NextResponse.json({ id: h.id });
  } catch (e) {
    return err(e);
  }
}
