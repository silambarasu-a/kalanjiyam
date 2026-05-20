import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { computeBatchAnalytics } from "@/lib/livestock-analytics";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[livestock-by-shed]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

/**
 * Per-shed (i.e. Land) rollup of active livestock activity. Useful for
 * multi-shed broiler operations where one farmer runs 3-4 sheds in
 * parallel and wants to compare them. Buckets every active batch by
 * its `landId`; "Unassigned" gathers batches with no shed link.
 */
export async function GET() {
  try {
    const ctx = await requireWorkspace("livestock", "read");

    const batches = await prisma.livestockBatch.findMany({
      where: {
        active: true,
        livestock: { workspaceId: ctx.workspaceId },
      },
      include: {
        livestock: { select: { id: true, name: true } },
        contract: true,
        land: { select: { id: true, name: true, area: true, areaUnit: true } },
      },
    });

    if (batches.length === 0) return NextResponse.json({ sheds: [] });

    const batchIds = batches.map((b) => b.id);
    const [events, feedLogs, weighings, mortality] = await Promise.all([
      prisma.livestockEvent.findMany({ where: { batchId: { in: batchIds } } }),
      prisma.feedLog.findMany({ where: { batchId: { in: batchIds } } }),
      prisma.weighingLog.findMany({ where: { batchId: { in: batchIds } } }),
      prisma.mortalityLog.findMany({ where: { batchId: { in: batchIds } } }),
    ]);

    type ShedAgg = {
      landId: string | null;
      landName: string;
      area: number | null;
      areaUnit: string | null;
      batches: {
        id: string;
        name: string;
        livestockName: string;
        productionType: string;
        head: number;
        mortalityPct: number;
        fcr: number | null;
        daysInCycle: number;
      }[];
      totalHead: number;
      avgMortalityPct: number;
      // Density: animals per area unit. Helps spot overcrowded sheds.
      densityPerUnit: number | null;
    };

    const buckets = new Map<string, ShedAgg>();
    for (const b of batches) {
      const key = b.landId ?? "__unassigned__";
      const analytics = computeBatchAnalytics({
        batch: b,
        events: events.filter((e) => e.batchId === b.id),
        feedLogs: feedLogs.filter((f) => f.batchId === b.id),
        weighings: weighings.filter((w) => w.batchId === b.id),
        mortality: mortality.filter((m) => m.batchId === b.id),
        contract: b.contract,
      });
      const existing =
        buckets.get(key) ??
        ({
          landId: b.landId,
          landName: b.land?.name ?? "Unassigned",
          area: b.land?.area == null ? null : Number(b.land.area),
          areaUnit: b.land?.areaUnit ?? null,
          batches: [],
          totalHead: 0,
          avgMortalityPct: 0,
          densityPerUnit: null,
        } as ShedAgg);
      existing.batches.push({
        id: b.id,
        name: b.name,
        livestockName: b.livestock.name,
        productionType: b.productionType,
        head: b.currentCount,
        mortalityPct: analytics.mortalityPct,
        fcr: analytics.fcr,
        daysInCycle: analytics.daysInCycle,
      });
      existing.totalHead += b.currentCount;
      buckets.set(key, existing);
    }

    // Second pass — finalise averages + density once all batches are in.
    const sheds = [...buckets.values()].map((s) => {
      const avg =
        s.batches.length > 0
          ? s.batches.reduce((sum, b) => sum + b.mortalityPct, 0) /
            s.batches.length
          : 0;
      return {
        ...s,
        avgMortalityPct: +avg.toFixed(2),
        densityPerUnit:
          s.area != null && s.area > 0
            ? +(s.totalHead / s.area).toFixed(2)
            : null,
      };
    });

    // Unassigned bucket last; everything else by total head desc.
    sheds.sort((a, b) => {
      if (a.landId == null && b.landId != null) return 1;
      if (a.landId != null && b.landId == null) return -1;
      return b.totalHead - a.totalHead;
    });

    return NextResponse.json({ sheds });
  } catch (e) {
    return err(e);
  }
}
