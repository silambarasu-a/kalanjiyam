import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  requireWorkspace,
  WorkspaceAccessError,
  assertWorkspaceContact,
} from "@/lib/workspace";
import { medicalRecordUpdateSchema } from "@/lib/validators-domain";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[medical-records/:id]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireWorkspace("medical", "read");
    const { id } = await context.params;
    const r = await prisma.medicalRecord.findUnique({
      where: { id },
      include: {
        patientContact: { select: { id: true, name: true, relationship: true } },
        claim: {
          select: {
            id: true,
            claimNumber: true,
            status: true,
            claimedAmount: true,
            approvedAmount: true,
            receivedAmount: true,
            investmentId: true,
          },
        },
        transactions: {
          // Belt-and-braces: never surface another workspace's bills even
          // if a stray cross-workspace link exists.
          where: { workspaceId: ctx.workspaceId },
          orderBy: { date: "asc" },
          select: {
            id: true,
            amount: true,
            date: true,
            description: true,
            hospitalizationStage: true,
            categoryId: true,
            category: {
              select: {
                id: true,
                name: true,
                parent: { select: { id: true, name: true } },
              },
            },
            account: { select: { id: true, name: true } },
            card: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!r || r.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({
      record: {
        id: r.id,
        kind: r.kind,
        facilityName: r.facilityName,
        diagnosis: r.diagnosis,
        occurredAt: r.occurredAt.toISOString(),
        dischargedAt: r.dischargedAt?.toISOString() ?? null,
        notes: r.notes,
        patientContact: r.patientContact,
        claim: r.claim
          ? {
              ...r.claim,
              claimedAmount:
                r.claim.claimedAmount == null ? null : Number(r.claim.claimedAmount),
              approvedAmount:
                r.claim.approvedAmount == null ? null : Number(r.claim.approvedAmount),
              receivedAmount:
                r.claim.receivedAmount == null ? null : Number(r.claim.receivedAmount),
            }
          : null,
        transactions: r.transactions.map((t) => ({
          id: t.id,
          amount: Number(t.amount),
          date: t.date.toISOString(),
          description: t.description,
          hospitalizationStage: t.hospitalizationStage,
          category: t.category,
          account: t.account,
          card: t.card,
        })),
      },
    });
  } catch (e) {
    return err(e);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireWorkspace("medical", "write");
    const { id } = await context.params;
    const existing = await prisma.medicalRecord.findUnique({ where: { id } });
    if (!existing || existing.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const body = await request.json();
    const parsed = medicalRecordUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const data = parsed.data;
    if (data.patientContactId) {
      await assertWorkspaceContact(ctx.workspaceId, data.patientContactId);
    }
    const kind = data.kind ?? existing.kind;
    const dischargedAt =
      data.dischargedAt !== undefined
        ? data.dischargedAt
          ? new Date(data.dischargedAt)
          : null
        : existing.dischargedAt;
    const updated = await prisma.medicalRecord.update({
      where: { id },
      data: {
        patientContactId: data.patientContactId ?? existing.patientContactId,
        kind,
        facilityName: data.facilityName ?? existing.facilityName,
        diagnosis: data.diagnosis ?? existing.diagnosis,
        occurredAt: data.occurredAt ? new Date(data.occurredAt) : existing.occurredAt,
        dischargedAt: kind === "CHECKUP" ? null : dischargedAt,
        notes: data.notes ?? existing.notes,
      },
    });
    return NextResponse.json({ id: updated.id });
  } catch (e) {
    return err(e);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireWorkspace("medical", "write");
    const { id } = await context.params;
    const existing = await prisma.medicalRecord.findUnique({
      where: { id },
      include: {
        claim: { select: { id: true } },
        _count: { select: { transactions: true } },
      },
    });
    if (!existing || existing.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (existing._count.transactions > 0) {
      return NextResponse.json(
        { error: "This record has linked transactions. Unlink them first." },
        { status: 409 },
      );
    }
    if (existing.claim) {
      return NextResponse.json(
        { error: "This record has a linked insurance claim. Unlink it first." },
        { status: 409 },
      );
    }
    await prisma.medicalRecord.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}
