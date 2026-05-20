import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { livestockBatchUpdateSchema } from "@/lib/validators-domain";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

async function loadBatch(id: string, workspaceId: string) {
  const batch = await prisma.livestockBatch.findUnique({
    where: { id },
    include: { livestock: { select: { workspaceId: true } } },
  });
  if (!batch || batch.livestock.workspaceId !== workspaceId) return null;
  return batch;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireWorkspace("livestock", "read");
    const { id } = await context.params;
    const fullBatch = await prisma.livestockBatch.findUnique({
      where: { id },
      include: {
        livestock: { select: { workspaceId: true } },
        contract: {
          select: {
            id: true,
            integratorName: true,
            contractRef: true,
            agreedRatePerKg: true,
          },
        },
        land: {
          select: {
            id: true,
            name: true,
            area: true,
            areaUnit: true,
          },
        },
      },
    });
    if (!fullBatch || fullBatch.livestock.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const batch = fullBatch;

    const [
      events,
      feedLogs,
      vaccinations,
      weighings,
      mortality,
      animals,
      milkLogs,
      eggLogs,
      healthLogs,
      incomeAgg,
      expenseAgg,
      laborAgg,
    ] = await Promise.all([
      prisma.livestockEvent.findMany({
        where: { batchId: id },
        orderBy: { date: "desc" },
      }),
      prisma.feedLog.findMany({ where: { batchId: id }, orderBy: { date: "desc" }, take: 100 }),
      prisma.vaccinationLog.findMany({
        where: { batchId: id },
        orderBy: { date: "desc" },
        take: 50,
      }),
      prisma.weighingLog.findMany({
        where: { batchId: id },
        orderBy: { date: "desc" },
      }),
      prisma.mortalityLog.findMany({
        where: { batchId: id },
        orderBy: { date: "desc" },
      }),
      prisma.livestockAnimal.findMany({
        where: { batchId: id },
        orderBy: [{ active: "desc" }, { tagNumber: "asc" }],
      }),
      prisma.milkLog.findMany({
        where: { batchId: id },
        orderBy: { date: "desc" },
      }),
      prisma.eggProductionLog.findMany({
        where: { batchId: id },
        orderBy: { date: "desc" },
      }),
      prisma.healthLog.findMany({
        where: { batchId: id },
        orderBy: [{ resolved: "asc" }, { date: "desc" }],
      }),
      prisma.transaction.aggregate({
        where: { livestockBatchId: id, type: "INCOME" },
        _sum: { amount: true },
      }),
      prisma.transaction.aggregate({
        where: { livestockBatchId: id, type: "EXPENSE" },
        _sum: { amount: true },
      }),
      prisma.transaction.aggregate({
        where: { livestockBatchId: id, kind: "WAGE" },
        _sum: { amount: true },
      }),
    ]);

    return NextResponse.json({
      batch: {
        id: batch.id,
        name: batch.name,
        productionType: batch.productionType,
        contractId: batch.contractId,
        contract: batch.contract
          ? {
              id: batch.contract.id,
              integratorName: batch.contract.integratorName,
              contractRef: batch.contract.contractRef,
              agreedRatePerKg: Number(batch.contract.agreedRatePerKg),
            }
          : null,
        startDate: batch.startDate.toISOString(),
        endDate: batch.endDate?.toISOString() ?? null,
        expectedCycleDays: batch.expectedCycleDays,
        initialCount: batch.initialCount,
        currentCount: batch.currentCount,
        initialAvgWeight:
          batch.initialAvgWeight == null
            ? null
            : Number(batch.initialAvgWeight),
        targetWeight:
          batch.targetWeight == null ? null : Number(batch.targetWeight),
        targetFCR: batch.targetFCR == null ? null : Number(batch.targetFCR),
        notes: batch.notes,
        active: batch.active,
        livestockId: batch.livestockId,
        landId: batch.landId,
        land: batch.land
          ? {
              id: batch.land.id,
              name: batch.land.name,
              area: batch.land.area == null ? null : Number(batch.land.area),
              areaUnit: batch.land.areaUnit,
            }
          : null,
      },
      summary: {
        income: Number(incomeAgg._sum.amount ?? 0),
        expense: Number(expenseAgg._sum.amount ?? 0),
        // Labor is a subset of `expense` — we surface it separately so
        // the batch detail page can break it out of the EXPENSE bar.
        // Comes from WAGE-kind transactions tagged to this batch (the
        // wage-payment flow does this when the attendance row carries
        // a livestockBatchId).
        labor: Number(laborAgg._sum.amount ?? 0),
        net: Number(incomeAgg._sum.amount ?? 0) - Number(expenseAgg._sum.amount ?? 0),
      },
      events: events.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        date: e.date.toISOString(),
        count: e.count,
        unitValue: e.unitValue == null ? null : Number(e.unitValue),
        avgWeightKg: e.avgWeightKg == null ? null : Number(e.avgWeightKg),
        totalWeightKg:
          e.totalWeightKg == null ? null : Number(e.totalWeightKg),
        notes: e.notes,
      })),
      feedLogs: feedLogs.map((f) => ({
        id: f.id,
        date: f.date.toISOString(),
        amount: Number(f.amount),
        quantity: f.quantity == null ? null : Number(f.quantity),
        unit: f.unit,
        notes: f.notes,
      })),
      vaccinations: vaccinations.map((v) => ({
        id: v.id,
        vaccine: v.vaccine,
        date: v.date.toISOString(),
        nextDueDate: v.nextDueDate?.toISOString() ?? null,
        cost: v.cost == null ? null : Number(v.cost),
        notes: v.notes,
      })),
      weighings: weighings.map((w) => ({
        id: w.id,
        animalId: w.animalId,
        phase: w.phase,
        date: w.date.toISOString(),
        sampleSize: w.sampleSize,
        totalKg: Number(w.totalKg),
        avgKg: Number(w.avgKg),
        notes: w.notes,
      })),
      mortality: mortality.map((m) => ({
        id: m.id,
        animalId: m.animalId,
        date: m.date.toISOString(),
        count: m.count,
        cause: m.cause,
        culled: m.culled,
        notes: m.notes,
      })),
      animals: animals.map((a) => ({
        id: a.id,
        tagNumber: a.tagNumber,
        name: a.name,
        sex: a.sex,
        dob: a.dob?.toISOString() ?? null,
        breed: a.breed,
        color: a.color,
        notes: a.notes,
        active: a.active,
      })),
      milkLogs: milkLogs.map((m) => ({
        id: m.id,
        animalId: m.animalId,
        date: m.date.toISOString(),
        totalLitres: Number(m.totalLitres),
        sessions: m.sessions,
        fatPct: m.fatPct == null ? null : Number(m.fatPct),
        snfPct: m.snfPct == null ? null : Number(m.snfPct),
        soldLitres: m.soldLitres == null ? null : Number(m.soldLitres),
        ratePerLitre:
          m.ratePerLitre == null ? null : Number(m.ratePerLitre),
        transactionId: m.transactionId,
        notes: m.notes,
      })),
      eggLogs: eggLogs.map((e) => ({
        id: e.id,
        date: e.date.toISOString(),
        collected: e.collected,
        grades: e.grades,
        broken: e.broken,
        sold: e.sold,
        salePricePerEgg:
          e.salePricePerEgg == null ? null : Number(e.salePricePerEgg),
        transactionId: e.transactionId,
        notes: e.notes,
      })),
      healthLogs: healthLogs.map((h) => ({
        id: h.id,
        animalId: h.animalId,
        date: h.date.toISOString(),
        condition: h.condition,
        treatment: h.treatment,
        cost: h.cost == null ? null : Number(h.cost),
        resolved: h.resolved,
        resolvedAt: h.resolvedAt?.toISOString() ?? null,
        transactionId: h.transactionId,
        notes: h.notes,
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
    const ctx = await requireWorkspace("livestock", "write");
    const { id } = await context.params;
    const batch = await loadBatch(id, ctx.workspaceId);
    if (!batch) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const body = await request.json();
    const parsed = livestockBatchUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const updated = await prisma.livestockBatch.update({
      where: { id },
      data: {
        name: parsed.data.name ?? batch.name,
        productionType: parsed.data.productionType ?? batch.productionType,
        contractId:
          parsed.data.contractId === undefined
            ? batch.contractId
            : (parsed.data.contractId ?? null),
        startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : batch.startDate,
        endDate:
          parsed.data.endDate === undefined
            ? batch.endDate
            : parsed.data.endDate
              ? new Date(parsed.data.endDate)
              : null,
        expectedCycleDays:
          parsed.data.expectedCycleDays === undefined
            ? batch.expectedCycleDays
            : parsed.data.expectedCycleDays,
        initialAvgWeight:
          parsed.data.initialAvgWeight === undefined
            ? batch.initialAvgWeight
            : (parsed.data.initialAvgWeight ?? null),
        targetWeight:
          parsed.data.targetWeight === undefined
            ? batch.targetWeight
            : (parsed.data.targetWeight ?? null),
        targetFCR:
          parsed.data.targetFCR === undefined
            ? batch.targetFCR
            : (parsed.data.targetFCR ?? null),
        notes: parsed.data.notes ?? batch.notes,
        active: parsed.data.active ?? batch.active,
        landId: parsed.data.landId === undefined ? batch.landId : parsed.data.landId,
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
    const ctx = await requireWorkspace("livestock", "write");
    const { id } = await context.params;
    const batch = await loadBatch(id, ctx.workspaceId);
    if (!batch) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const eventCount = await prisma.livestockEvent.count({ where: { batchId: id } });
    if (eventCount > 0) {
      return NextResponse.json(
        { error: "Batch has events — close it (active=false) instead of deleting." },
        { status: 400 }
      );
    }
    await prisma.livestockBatch.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}
