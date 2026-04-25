import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { cropBatchCreateSchema } from "@/lib/validators-domain";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const ctx = await requireWorkspace("crops", "read");
    const url = new URL(request.url);
    const cropId = url.searchParams.get("cropId");
    const activeOnly = url.searchParams.get("active") !== "false";
    const batches = await prisma.cropBatch.findMany({
      where: {
        crop: { workspaceId: ctx.workspaceId },
        ...(cropId ? { cropId } : {}),
        ...(activeOnly ? { active: true } : {}),
      },
      include: {
        crop: { select: { id: true, name: true } },
        land: { select: { id: true, name: true } },
      },
      orderBy: [{ active: "desc" }, { startDate: "desc" }, { createdAt: "desc" }],
    });
    return NextResponse.json({
      batches: batches.map((b) => ({
        id: b.id,
        name: b.name,
        status: b.status,
        startDate: b.startDate?.toISOString() ?? null,
        endDate: b.endDate?.toISOString() ?? null,
        expectedCycleDays: b.expectedCycleDays,
        notes: b.notes,
        active: b.active,
        crop: b.crop,
        land: b.land,
      })),
    });
  } catch (e) {
    return err(e);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireWorkspace("crops", "write");
    const body = await request.json();
    const parsed = cropBatchCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    // Verify crop belongs to this workspace
    const crop = await prisma.crop.findUnique({ where: { id: parsed.data.cropId } });
    if (!crop || crop.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Crop not found" }, { status: 404 });
    }
    if (parsed.data.landId) {
      const land = await prisma.land.findUnique({ where: { id: parsed.data.landId } });
      if (!land || land.workspaceId !== ctx.workspaceId) {
        return NextResponse.json({ error: "Land not found" }, { status: 404 });
      }
    }
    const batch = await prisma.cropBatch.create({
      data: {
        cropId: parsed.data.cropId,
        landId: parsed.data.landId ?? null,
        name: parsed.data.name,
        status: parsed.data.status ?? "ACTIVE",
        startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : null,
        endDate: parsed.data.endDate ? new Date(parsed.data.endDate) : null,
        expectedCycleDays: parsed.data.expectedCycleDays ?? null,
        notes: parsed.data.notes,
      },
    });
    return NextResponse.json({ id: batch.id });
  } catch (e) {
    return err(e);
  }
}
