import { NextResponse } from "next/server";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { TIMING } from "@/lib/timing";
import { getDashboardCashflow } from "@/lib/dashboard-data";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[dashboard/cashflow]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

/**
 * Upcoming dues + settled-this-month list + monthly totals. Loads
 * independently from /api/dashboard/stats so a slow query in here
 * doesn't block the top-tile render.
 */
export async function GET() {
  try {
    const ctx = await requireWorkspace("dashboard", "read");

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const monthStart = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1),
    );
    const nextMonthBegin = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1),
    );
    const daysInThisMonth = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0),
    ).getUTCDate();
    const isNearMonthEnd = today.getUTCDate() > daysInThisMonth - 7;
    // Window: at least `dashboardUpcomingDuesDays` ahead, but also through
    // end of next calendar month. Otherwise a bill due late in the next
    // month (typical for a credit card whose statementDate is after today's
    // date-of-month) silently falls off the dashboard and the user sees
    // "nothing due" while a real bill is looming.
    const rolling = new Date(today);
    rolling.setUTCDate(rolling.getUTCDate() + TIMING.dashboardUpcomingDuesDays);
    const endOfNextMonth = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 2, 0),
    );
    const windowEnd =
      rolling.getTime() > endOfNextMonth.getTime() ? rolling : endOfNextMonth;

    const cashflow = await getDashboardCashflow({
      workspaceId: ctx.workspaceId,
      today,
      windowEnd,
      monthStart,
      nextMonthBegin,
      isNearMonthEnd,
    });
    return NextResponse.json(cashflow);
  } catch (e) {
    return err(e);
  }
}
