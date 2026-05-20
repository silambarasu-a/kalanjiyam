import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { computeBatchAnalytics } from "@/lib/livestock-analytics";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[livestock-overview]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

/**
 * Workspace-wide livestock dashboard widget data:
 *   - top-line KPIs (active batches, total head, 30-day mortality, FCR
 *     across contract batches),
 *   - top-3 batches needing attention (high mortality / FCR over target),
 *   - any contract batches close to lift / payout.
 *
 * Computed by replaying each batch through `computeBatchAnalytics`
 * (cheap — already optimised for the per-batch endpoint).
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
      },
      orderBy: { startDate: "desc" },
    });

    if (batches.length === 0) {
      return NextResponse.json({
        activeBatches: 0,
        totalHead: 0,
        avgMortalityPct: 0,
        contractBatches: 0,
        avgContractFCR: null,
        attentionBatches: [],
        last30dMilkLitres: 0,
      });
    }

    const batchIds = batches.map((b) => b.id);
    const [allEvents, allFeed, allWeighings, allMortality, allMilk] =
      await Promise.all([
        prisma.livestockEvent.findMany({ where: { batchId: { in: batchIds } } }),
        prisma.feedLog.findMany({ where: { batchId: { in: batchIds } } }),
        prisma.weighingLog.findMany({ where: { batchId: { in: batchIds } } }),
        prisma.mortalityLog.findMany({ where: { batchId: { in: batchIds } } }),
        prisma.milkLog.findMany({ where: { batchId: { in: batchIds } } }),
      ]);

    let totalHead = 0;
    let mortalitySum = 0;
    let mortalityCount = 0;
    let contractFcrSum = 0;
    let contractFcrCount = 0;
    const cutoffMs = Date.now() - 30 * 86400000;
    const last30dMilkLitres = allMilk
      .filter((m) => m.date.getTime() >= cutoffMs)
      .reduce((s, m) => s + Number(m.totalLitres), 0);

    const attentionRows: {
      id: string;
      name: string;
      livestockId: string;
      livestockName: string;
      productionType: string;
      head: number;
      mortalityPct: number;
      fcr: number | null;
      targetFCR: number | null;
      daysInCycle: number;
      expectedCycleDays: number | null;
      severity: "mortality" | "fcr" | "exit-soon";
    }[] = [];

    for (const b of batches) {
      totalHead += b.currentCount;
      const analytics = computeBatchAnalytics({
        batch: b,
        events: allEvents.filter((e) => e.batchId === b.id),
        feedLogs: allFeed.filter((f) => f.batchId === b.id),
        weighings: allWeighings.filter((w) => w.batchId === b.id),
        mortality: allMortality.filter((m) => m.batchId === b.id),
        contract: b.contract,
      });
      mortalitySum += analytics.mortalityPct;
      mortalityCount++;
      if (b.productionType === "BROILER_CONTRACT" && analytics.fcr != null) {
        contractFcrSum += analytics.fcr;
        contractFcrCount++;
      }

      // Build attention list — rules:
      //   - mortality > 5% (industry benchmark)
      //   - FCR above target by more than 5%
      //   - cycle ≥ 90% complete (lift / sale window)
      const fcrTooHigh =
        analytics.fcr != null &&
        b.targetFCR != null &&
        Number(b.targetFCR) > 0 &&
        analytics.fcr > Number(b.targetFCR) * 1.05;
      const exitSoon =
        b.expectedCycleDays != null &&
        b.expectedCycleDays > 0 &&
        analytics.daysInCycle / b.expectedCycleDays >= 0.9;
      const highMortality = analytics.mortalityPct > 5;
      if (highMortality || fcrTooHigh || exitSoon) {
        attentionRows.push({
          id: b.id,
          name: b.name,
          livestockId: b.livestockId,
          livestockName: b.livestock.name,
          productionType: b.productionType,
          head: b.currentCount,
          mortalityPct: analytics.mortalityPct,
          fcr: analytics.fcr,
          targetFCR: b.targetFCR == null ? null : Number(b.targetFCR),
          daysInCycle: analytics.daysInCycle,
          expectedCycleDays: b.expectedCycleDays,
          severity: highMortality
            ? "mortality"
            : fcrTooHigh
              ? "fcr"
              : "exit-soon",
        });
      }
    }

    // Sort attention: mortality > fcr > exit-soon, then by severity within
    // each bucket (high mortality first, then biggest FCR overage).
    attentionRows.sort((a, b) => {
      const order = { mortality: 0, fcr: 1, "exit-soon": 2 } as const;
      const da = order[a.severity] - order[b.severity];
      if (da !== 0) return da;
      if (a.severity === "mortality") return b.mortalityPct - a.mortalityPct;
      if (a.severity === "fcr")
        return (b.fcr ?? 0) - (a.fcr ?? 0);
      return (
        (b.daysInCycle / (b.expectedCycleDays ?? 1)) -
        (a.daysInCycle / (a.expectedCycleDays ?? 1))
      );
    });

    return NextResponse.json({
      activeBatches: batches.length,
      totalHead,
      avgMortalityPct:
        mortalityCount > 0
          ? +(mortalitySum / mortalityCount).toFixed(2)
          : 0,
      contractBatches: batches.filter(
        (b) => b.productionType === "BROILER_CONTRACT",
      ).length,
      avgContractFCR:
        contractFcrCount > 0
          ? +(contractFcrSum / contractFcrCount).toFixed(2)
          : null,
      attentionBatches: attentionRows.slice(0, 5),
      last30dMilkLitres: +last30dMilkLitres.toFixed(1),
    });
  } catch (e) {
    return err(e);
  }
}
