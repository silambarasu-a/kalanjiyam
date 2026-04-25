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
        startDate: b.startDate.toISOString(),
        endDate: b.endDate?.toISOString() ?? null,
        expectedCycleDays: b.expectedCycleDays,
        initialCount: b.initialCount,
        currentCount: b.currentCount,
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
    const batch = await prisma.livestockBatch.create({
      data: {
        livestockId: parsed.data.livestockId,
        landId: parsed.data.landId ?? null,
        name: parsed.data.name,
        startDate: new Date(parsed.data.startDate),
        endDate: parsed.data.endDate ? new Date(parsed.data.endDate) : null,
        expectedCycleDays: parsed.data.expectedCycleDays ?? null,
        initialCount: parsed.data.initialCount,
        currentCount: parsed.data.initialCount,
        notes: parsed.data.notes,
      },
    });
    return NextResponse.json({ id: batch.id });
  } catch (e) {
    return err(e);
  }
}
