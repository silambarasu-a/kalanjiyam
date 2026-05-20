import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[livestock-animals/[id]]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

/**
 * Per-animal detail: the animal row + all its weighings, health logs,
 * mortality (typically zero unless the animal died), and milk logs.
 * Workspace-scoped via the parent batch's livestock row.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireWorkspace("livestock", "read");
    const { id } = await context.params;
    const animal = await prisma.livestockAnimal.findUnique({
      where: { id },
      include: {
        batch: {
          select: {
            id: true,
            name: true,
            productionType: true,
            livestockId: true,
            livestock: { select: { workspaceId: true, name: true } },
          },
        },
      },
    });
    if (!animal || animal.batch.livestock.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const [weighings, healthLogs, mortality, milkLogs] = await Promise.all([
      prisma.weighingLog.findMany({
        where: { animalId: id },
        orderBy: { date: "desc" },
      }),
      prisma.healthLog.findMany({
        where: { animalId: id },
        orderBy: { date: "desc" },
      }),
      prisma.mortalityLog.findMany({
        where: { animalId: id },
        orderBy: { date: "desc" },
      }),
      prisma.milkLog.findMany({
        where: { animalId: id },
        orderBy: { date: "desc" },
      }),
    ]);

    return NextResponse.json({
      animal: {
        id: animal.id,
        tagNumber: animal.tagNumber,
        name: animal.name,
        sex: animal.sex,
        dob: animal.dob?.toISOString() ?? null,
        breed: animal.breed,
        color: animal.color,
        notes: animal.notes,
        active: animal.active,
        batchId: animal.batchId,
        batchName: animal.batch.name,
        productionType: animal.batch.productionType,
        livestockId: animal.batch.livestockId,
        livestockName: animal.batch.livestock.name,
      },
      weighings: weighings.map((w) => ({
        id: w.id,
        phase: w.phase,
        date: w.date.toISOString(),
        sampleSize: w.sampleSize,
        totalKg: Number(w.totalKg),
        avgKg: Number(w.avgKg),
        notes: w.notes,
      })),
      healthLogs: healthLogs.map((h) => ({
        id: h.id,
        date: h.date.toISOString(),
        condition: h.condition,
        treatment: h.treatment,
        cost: h.cost == null ? null : Number(h.cost),
        resolved: h.resolved,
        resolvedAt: h.resolvedAt?.toISOString() ?? null,
        notes: h.notes,
      })),
      mortality: mortality.map((m) => ({
        id: m.id,
        date: m.date.toISOString(),
        cause: m.cause,
        culled: m.culled,
        notes: m.notes,
      })),
      milkLogs: milkLogs.map((m) => ({
        id: m.id,
        date: m.date.toISOString(),
        totalLitres: Number(m.totalLitres),
        soldLitres: m.soldLitres == null ? null : Number(m.soldLitres),
        ratePerLitre:
          m.ratePerLitre == null ? null : Number(m.ratePerLitre),
        notes: m.notes,
      })),
    });
  } catch (e) {
    return err(e);
  }
}
