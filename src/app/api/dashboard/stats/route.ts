import { NextResponse } from "next/server";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { parsePeriodId, rangeToPrismaFilter } from "@/lib/statement-period";
import { getDashboardStats } from "@/lib/dashboard-data";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[dashboard/stats]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

/**
 * Top-tile balance-sheet snapshot. Splits the legacy summary route so
 * the dashboard can render this fast slice independently of the
 * heavier cashflow data (dues + settled).
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireWorkspace("dashboard", "read");
    const url = new URL(request.url);
    const periodParam = url.searchParams.get("period");
    const fromParam = url.searchParams.get("from");
    const toParam = url.searchParams.get("to");

    const now = new Date();
    let periodStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    let periodEnd = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
    );

    if (periodParam === "custom" && fromParam && toParam) {
      const s = new Date(`${fromParam}T00:00:00Z`);
      const e = new Date(`${toParam}T00:00:00Z`);
      if (!isNaN(s.getTime()) && !isNaN(e.getTime())) {
        periodStart = s;
        periodEnd = e;
      }
    } else if (periodParam) {
      const parsed = parsePeriodId(periodParam);
      if (parsed) {
        periodStart = parsed.start;
        periodEnd = parsed.end;
      }
    }
    const periodFilter = rangeToPrismaFilter({ start: periodStart, end: periodEnd });

    const stats = await getDashboardStats({
      workspaceId: ctx.workspaceId,
      periodStart,
      periodEnd,
      periodFilter,
    });
    return NextResponse.json(stats);
  } catch (e) {
    return err(e);
  }
}
