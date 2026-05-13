import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  requireWorkspace,
  WorkspaceAccessError,
  assertWorkspaceContact,
} from "@/lib/workspace";
import { hospitalizationUpdateSchema } from "@/lib/validators-domain";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[hospitalizations/:id]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireWorkspace("medical", "read");
    const { id } = await context.params;
    const h = await prisma.hospitalization.findUnique({
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
          orderBy: { date: "asc" },
          select: {
            id: true,
            amount: true,
            date: true,
            description: true,
            hospitalizationStage: true,
            categoryId: true,
            category: { select: { id: true, name: true } },
            account: { select: { id: true, name: true } },
            card: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!h || h.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({
      hospitalization: {
        id: h.id,
        hospitalName: h.hospitalName,
        diagnosis: h.diagnosis,
        admittedAt: h.admittedAt.toISOString(),
        dischargedAt: h.dischargedAt?.toISOString() ?? null,
        notes: h.notes,
        patientContact: h.patientContact,
        claim: h.claim
          ? {
              ...h.claim,
              claimedAmount:
                h.claim.claimedAmount == null ? null : Number(h.claim.claimedAmount),
              approvedAmount:
                h.claim.approvedAmount == null ? null : Number(h.claim.approvedAmount),
              receivedAmount:
                h.claim.receivedAmount == null ? null : Number(h.claim.receivedAmount),
            }
          : null,
        transactions: h.transactions.map((t) => ({
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
    const existing = await prisma.hospitalization.findUnique({ where: { id } });
    if (!existing || existing.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const body = await request.json();
    const parsed = hospitalizationUpdateSchema.safeParse(body);
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
    const updated = await prisma.hospitalization.update({
      where: { id },
      data: {
        patientContactId: data.patientContactId ?? existing.patientContactId,
        hospitalName: data.hospitalName ?? existing.hospitalName,
        diagnosis: data.diagnosis ?? existing.diagnosis,
        admittedAt: data.admittedAt ? new Date(data.admittedAt) : existing.admittedAt,
        dischargedAt:
          data.dischargedAt !== undefined
            ? data.dischargedAt
              ? new Date(data.dischargedAt)
              : null
            : existing.dischargedAt,
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
    const existing = await prisma.hospitalization.findUnique({
      where: { id },
      include: { _count: { select: { transactions: true } } },
    });
    if (!existing || existing.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (existing._count.transactions > 0) {
      return NextResponse.json(
        { error: "This episode has linked transactions. Unlink them first." },
        { status: 409 },
      );
    }
    await prisma.hospitalization.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}
