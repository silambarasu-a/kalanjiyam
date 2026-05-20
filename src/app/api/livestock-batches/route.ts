import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { livestockBatchCreateSchema } from "@/lib/validators-domain";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const ctx = await requireWorkspace("livestock", "read");
    const url = new URL(request.url);
    const livestockId = url.searchParams.get("livestockId");
    const activeOnly = url.searchParams.get("active") !== "false";
    const batches = await prisma.livestockBatch.findMany({
      where: {
        livestock: { workspaceId: ctx.workspaceId },
        ...(livestockId ? { livestockId } : {}),
        ...(activeOnly ? { active: true } : {}),
      },
      orderBy: [{ active: "desc" }, { startDate: "desc" }],
      include: {
        livestock: { select: { id: true, name: true } },
        land: { select: { id: true, name: true } },
      },
    });
    return NextResponse.json({
      batches: batches.map((b) => ({
        id: b.id,
        name: b.name,
        productionType: b.productionType,
        contractId: b.contractId,
        startDate: b.startDate.toISOString(),
        endDate: b.endDate?.toISOString() ?? null,
        expectedCycleDays: b.expectedCycleDays,
        initialCount: b.initialCount,
        currentCount: b.currentCount,
        initialAvgWeight:
          b.initialAvgWeight == null ? null : Number(b.initialAvgWeight),
        targetWeight: b.targetWeight == null ? null : Number(b.targetWeight),
        targetFCR: b.targetFCR == null ? null : Number(b.targetFCR),
        notes: b.notes,
        active: b.active,
        livestock: b.livestock,
        land: b.land,
      })),
    });
  } catch (e) {
    return err(e);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireWorkspace("livestock", "write");
    const body = await request.json();
    const parsed = livestockBatchCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const livestock = await prisma.livestock.findUnique({
      where: { id: parsed.data.livestockId },
    });
    if (!livestock || livestock.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Livestock not found" }, { status: 404 });
    }
    if (parsed.data.landId) {
      const land = await prisma.land.findUnique({ where: { id: parsed.data.landId } });
      if (!land || land.workspaceId !== ctx.workspaceId) {
        return NextResponse.json({ error: "Land not found" }, { status: 404 });
      }
    }
    if (parsed.data.contractId) {
      const contract = await prisma.livestockContract.findUnique({
        where: { id: parsed.data.contractId },
        select: { workspaceId: true },
      });
      if (!contract || contract.workspaceId !== ctx.workspaceId) {
        return NextResponse.json({ error: "Contract not found" }, { status: 404 });
      }
    }
    const batch = await prisma.livestockBatch.create({
      data: {
        livestockId: parsed.data.livestockId,
        landId: parsed.data.landId ?? null,
        contractId: parsed.data.contractId ?? null,
        name: parsed.data.name,
        productionType: parsed.data.productionType ?? "DUAL_PURPOSE",
        startDate: new Date(parsed.data.startDate),
        endDate: parsed.data.endDate ? new Date(parsed.data.endDate) : null,
        expectedCycleDays: parsed.data.expectedCycleDays ?? null,
        initialCount: parsed.data.initialCount,
        currentCount: parsed.data.initialCount,
        initialAvgWeight: parsed.data.initialAvgWeight ?? null,
        targetWeight: parsed.data.targetWeight ?? null,
        targetFCR: parsed.data.targetFCR ?? null,
        notes: parsed.data.notes,
      },
    });
    // When the cycle length is known, plant a reminder for "cycle
    // ending soon" so the notifications cron fires 5/3/1/0 days out.
    if (parsed.data.expectedCycleDays && parsed.data.expectedCycleDays > 0) {
      const due = new Date(parsed.data.startDate);
      due.setUTCDate(due.getUTCDate() + parsed.data.expectedCycleDays);
      await prisma.investmentReminder.create({
        data: {
          workspaceId: ctx.workspaceId,
          kind: "LIVESTOCK_CYCLE_ENDING",
          dueDate: due,
          livestockBatchId: batch.id,
        },
      });
    }
    return NextResponse.json({ id: batch.id });
  } catch (e) {
    return err(e);
  }
}
