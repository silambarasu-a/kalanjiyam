import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { computeBatchAnalytics } from "@/lib/livestock-analytics";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[livestock-batches/[id]/analytics]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

/**
 * Computes FCR / ADG / mortality% / projected contract payout. The
 * heavy lifting lives in `computeBatchAnalytics` so callers (including
 * future jobs / exports) can share the math.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireWorkspace("livestock", "read");
    const { id } = await context.params;
    const batch = await prisma.livestockBatch.findUnique({
      where: { id },
      include: {
        livestock: { select: { workspaceId: true } },
        contract: true,
      },
    });
    if (!batch || batch.livestock.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const [events, feedLogs, weighings, mortality] = await Promise.all([
      prisma.livestockEvent.findMany({ where: { batchId: id } }),
      prisma.feedLog.findMany({ where: { batchId: id } }),
      prisma.weighingLog.findMany({ where: { batchId: id } }),
      prisma.mortalityLog.findMany({ where: { batchId: id } }),
    ]);

    const analytics = computeBatchAnalytics({
      batch,
      events,
      feedLogs,
      weighings,
      mortality,
      contract: batch.contract,
    });

    return NextResponse.json({ analytics });
  } catch (e) {
    return err(e);
  }
}
