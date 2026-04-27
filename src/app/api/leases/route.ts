import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { leaseCreateSchema } from "@/lib/validators-domain";
import { computeLeaseSchedule } from "@/lib/lease-schedule";
import {
  LeaseAssetType,
  LeaseDirection,
  LeaseFrequency,
  ReminderStatus,
} from "@/generated/prisma/client";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[leases]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const ctx = await requireWorkspace("leases", "read");
    const url = new URL(request.url);
    const direction = url.searchParams.get("direction");
    const leases = await prisma.lease.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        ...(direction ? { direction: direction as LeaseDirection } : {}),
      },
      orderBy: [{ active: "desc" }, { startDate: "desc" }],
      include: {
        cropBatch: {
          select: { id: true, name: true, crop: { select: { id: true, name: true } } },
        },
        livestockBatch: {
          select: {
            id: true,
            name: true,
            livestock: { select: { id: true, name: true } },
          },
        },
        lessorContact: { select: { id: true, name: true } },
        lesseeContact: { select: { id: true, name: true } },
        schedule: {
          select: { id: true, status: true, amount: true, dueDate: true },
        },
      },
    });
    return NextResponse.json({
      leases: leases.map((l) => {
        const upcoming = l.schedule.filter((s) => s.status === "UPCOMING");
        const confirmed = l.schedule.filter((s) => s.status === "CONFIRMED");
        const paid = confirmed.reduce((s, x) => s + Number(x.amount), 0);
        const outstanding = l.schedule.reduce(
          (s, x) => s + (x.status === "UPCOMING" ? Number(x.amount) : 0),
          0
        );
        return {
          id: l.id,
          direction: l.direction,
          amount: Number(l.amount),
          frequency: l.frequency,
          customMonths: l.customMonths,
          startDate: l.startDate.toISOString(),
          endDate: l.endDate.toISOString(),
          active: l.active,
          notes: l.notes,
          lessor: l.lessorContact ?? (l.lessorName ? { id: null, name: l.lessorName } : null),
          lessee: l.lesseeContact ?? (l.lesseeName ? { id: null, name: l.lesseeName } : null),
          assetType: l.assetType,
          cropBatch: l.cropBatch,
          livestockBatch: l.livestockBatch,
          totals: {
            upcoming: upcoming.length,
            confirmed: confirmed.length,
            totalInstallments: l.schedule.length,
            paid: Math.round(paid * 100) / 100,
            outstanding: Math.round(outstanding * 100) / 100,
          },
        };
      }),
    });
  } catch (e) {
    return err(e);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireWorkspace("leases", "write");
    const body = await request.json();
    const parsed = leaseCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const data = parsed.data;

    // Verify asset ownership.
    if (data.assetType === "CROP_BATCH" && data.cropBatchId) {
      const batch = await prisma.cropBatch.findUnique({
        where: { id: data.cropBatchId },
        include: { crop: { select: { workspaceId: true } } },
      });
      if (!batch || batch.crop.workspaceId !== ctx.workspaceId) {
        return NextResponse.json({ error: "Crop batch not found" }, { status: 404 });
      }
    }
    if (data.assetType === "LIVESTOCK_BATCH" && data.livestockBatchId) {
      const batch = await prisma.livestockBatch.findUnique({
        where: { id: data.livestockBatchId },
        include: { livestock: { select: { workspaceId: true } } },
      });
      if (!batch || batch.livestock.workspaceId !== ctx.workspaceId) {
        return NextResponse.json({ error: "Livestock batch not found" }, { status: 404 });
      }
    }

    const schedule = computeLeaseSchedule({
      startDate: new Date(data.startDate),
      endDate: new Date(data.endDate),
      frequency: data.frequency,
      customMonths: data.customMonths ?? null,
      totalAmount: data.amount,
    });

    const lease = await prisma.$transaction(async (tx) => {
      const l = await tx.lease.create({
        data: {
          workspaceId: ctx.workspaceId,
          direction: data.direction as LeaseDirection,
          lessorContactId: data.lessorContactId ?? null,
          lessorName: data.lessorName ?? null,
          lesseeContactId: data.lesseeContactId ?? null,
          lesseeName: data.lesseeName ?? null,
          assetType: data.assetType as LeaseAssetType,
          cropBatchId: data.assetType === "CROP_BATCH" ? data.cropBatchId ?? null : null,
          livestockBatchId:
            data.assetType === "LIVESTOCK_BATCH" ? data.livestockBatchId ?? null : null,
          amount: data.amount,
          frequency: data.frequency as LeaseFrequency,
          customMonths: data.customMonths ?? null,
          startDate: new Date(data.startDate),
          endDate: new Date(data.endDate),
          scheduleGenerated: schedule.length > 0,
          notes: data.notes,
        },
      });
      if (schedule.length > 0) {
        await tx.leasePaymentSchedule.createMany({
          data: schedule.map((s) => ({
            leaseId: l.id,
            dueDate: s.dueDate,
            amount: s.amount,
            status: ReminderStatus.UPCOMING,
          })),
        });
      }
      return l;
    });

    return NextResponse.json({ id: lease.id, scheduleCount: schedule.length });
  } catch (e) {
    return err(e);
  }
}
