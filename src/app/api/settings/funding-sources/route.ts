import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_FUNDING_SOURCE_ORDER,
  normalizeFundingSourceOrder,
} from "@/lib/funding-sources";

/**
 * GET /api/settings/funding-sources
 *
 * The active workspace's "Pay from" group order, read by every funding-
 * source picker. Any member may read it (it's display preference, not
 * data), so this deliberately skips the per-feature permission check.
 * Writes go through PATCH /api/workspaces/[id] like the other workspace
 * settings.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const workspaceId = session.user.activeWorkspaceId;
  if (!workspaceId) {
    return NextResponse.json({ order: DEFAULT_FUNDING_SOURCE_ORDER });
  }
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { fundingSourceOrder: true },
  });
  return NextResponse.json({
    order: normalizeFundingSourceOrder(ws?.fundingSourceOrder),
  });
}
