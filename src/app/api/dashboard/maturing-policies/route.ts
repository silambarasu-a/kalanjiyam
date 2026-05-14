import { NextResponse } from "next/server";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { getMaturingPolicies } from "@/lib/dashboard-data";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[dashboard/maturing-policies]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

/**
 * Life-family insurance policies (LIFE / TERM / ULIP / ENDOWMENT)
 * whose maturityAt falls in the next 90 days. Powers the "Policies
 * maturing soon" tile on the dashboard.
 */
export async function GET() {
  try {
    const ctx = await requireWorkspace("dashboard", "read");
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const policies = await getMaturingPolicies({
      workspaceId: ctx.workspaceId,
      today,
      windowDays: 90,
    });
    return NextResponse.json({ policies });
  } catch (e) {
    return err(e);
  }
}
