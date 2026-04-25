import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { leaseUpdateSchema } from "@/lib/validators-domain";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireWorkspace("leases", "read");
    const { id } = await context.params;
    const lease = await prisma.lease.findUnique({
      where: { id },
      include: {
        cropBatch: {
          select: { id: true, name: true, crop: { select: { id: true, name: true } } },
        },
        livestockBatch: {
          select: { id: true, name: true, livestock: { select: { id: true, name: true } } },
        },
        lessorMember: { select: { id: true, name: true } },
        lesseeMember: { select: { id: true, name: true } },
        schedule: {
          orderBy: { dueDate: "asc" },
          include: {
            confirmedTxn: {
              select: { id: true, description: true, date: true, accountId: true },
            },
          },
        },
      },
    });
    if (!lease || lease.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({
      lease: {
        id: lease.id,
        direction: lease.direction,
        amount: Number(lease.amount),
        frequency: lease.frequency,
        customMonths: lease.customMonths,
        startDate: lease.startDate.toISOString(),
        endDate: lease.endDate.toISOString(),
        active: lease.active,
        notes: lease.notes,
        lessor: lease.lessorMember ?? (lease.lessorName ? { id: null, name: lease.lessorName } : null),
        lessee: lease.lesseeMember ?? (lease.lesseeName ? { id: null, name: lease.lesseeName } : null),
        assetType: lease.assetType,
        cropBatch: lease.cropBatch,
        livestockBatch: lease.livestockBatch,
      },
      schedule: lease.schedule.map((s) => ({
        id: s.id,
        dueDate: s.dueDate.toISOString(),
        amount: Number(s.amount),
        status: s.status,
        confirmedTxn: s.confirmedTxn,
      })),
    });
  } catch (e) {
    return err(e);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireWorkspace("leases", "write");
    const { id } = await context.params;
    const existing = await prisma.lease.findUnique({ where: { id } });
    if (!existing || existing.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const body = await request.json();
    const parsed = leaseUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const updated = await prisma.lease.update({
      where: { id },
      data: {
        lessorMemberId:
          parsed.data.lessorMemberId === undefined
            ? existing.lessorMemberId
            : parsed.data.lessorMemberId,
        lessorName:
          parsed.data.lessorName === undefined ? existing.lessorName : parsed.data.lessorName,
        lesseeMemberId:
          parsed.data.lesseeMemberId === undefined
            ? existing.lesseeMemberId
            : parsed.data.lesseeMemberId,
        lesseeName:
          parsed.data.lesseeName === undefined ? existing.lesseeName : parsed.data.lesseeName,
        notes: parsed.data.notes ?? existing.notes,
        active: parsed.data.active ?? existing.active,
      },
    });
    return NextResponse.json({ id: updated.id });
  } catch (e) {
    return err(e);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireWorkspace("leases", "write");
    const { id } = await context.params;
    const existing = await prisma.lease.findUnique({ where: { id } });
    if (!existing || existing.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const confirmed = await prisma.leasePaymentSchedule.count({
      where: { leaseId: id, status: "CONFIRMED" },
    });
    if (confirmed > 0) {
      return NextResponse.json(
        { error: "Lease has confirmed payments — archive (active=false) instead." },
        { status: 400 }
      );
    }
    await prisma.lease.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}
