import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { canAccessRecord } from "@/lib/permissions";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[card-statements]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

/**
 * Lightweight list of materialised statements for a card. Used by the
 * refund flow to tell the user which billing cycle a given date will
 * affect (open / closed / future). Heavier per-statement detail still
 * lives on the card detail page.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireWorkspace("cards", "read");
    const session = await auth();
    const { id } = await context.params;
    const card = await prisma.card.findUnique({
      where: { id },
      select: {
        id: true,
        workspaceId: true,
        accountId: true,
        ownerUserId: true,
        sharedWithUserIds: true,
      },
    });
    if (!card || card.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!canAccessRecord(session, card)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (!card.accountId) {
      return NextResponse.json({ statements: [] });
    }
    const statements = await prisma.cardStatement.findMany({
      where: { accountId: card.accountId },
      orderBy: { periodStart: "desc" },
      take: 12,
      select: {
        id: true,
        periodStart: true,
        periodEnd: true,
        closedAt: true,
      },
    });
    return NextResponse.json({
      statements: statements.map((s) => ({
        id: s.id,
        periodStart: s.periodStart.toISOString(),
        periodEnd: s.periodEnd.toISOString(),
        closedAt: s.closedAt?.toISOString() ?? null,
      })),
    });
  } catch (e) {
    return err(e);
  }
}
