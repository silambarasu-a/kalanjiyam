import { NextResponse } from "next/server";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { getExpiringVehicleDocuments } from "@/lib/dashboard-data";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[dashboard/expiring-docs]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

/**
 * Vehicle documents (RC / FC / PUC / Road Tax / Insurance copy / Other)
 * expiring in the next 30 days, plus anything already overdue. Powers
 * the "Documents expiring soon" tile.
 */
export async function GET() {
  try {
    const ctx = await requireWorkspace("dashboard", "read");
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const documents = await getExpiringVehicleDocuments({
      workspaceId: ctx.workspaceId,
      today,
      windowDays: 30,
    });
    return NextResponse.json({ documents });
  } catch (e) {
    return err(e);
  }
}
