import { NextResponse } from "next/server";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { getLiquidByMember } from "@/lib/dashboard-data";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[dashboard/liquid-by-member]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function GET() {
  try {
    const ctx = await requireWorkspace("dashboard", "read");
    const data = await getLiquidByMember({ workspaceId: ctx.workspaceId });
    return NextResponse.json(data);
  } catch (e) {
    return err(e);
  }
}
