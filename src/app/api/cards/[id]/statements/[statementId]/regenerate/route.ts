import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { canModifyRecord } from "@/lib/permissions";
import {
  computeStatementTotalDue,
  recomputeStatementPaidAt,
} from "@/lib/card-statement-service";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[card-statement-regenerate]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

function canEditStatements(role: string): boolean {
  return role === "OWNER" || role === "ADMIN" || role === "SUPER_ADMIN";
}

/**
 * Discard any manual edit on a CardStatement and re-snapshot totalDue +
 * dueDate from the live transaction ledger. Reverses an EditStatement
 * action so the row returns to system-computed values and the materializer
 * is allowed to keep it in sync again.
 *
 * Restricted to OWNER / ADMIN / SUPER_ADMIN — same gate as Edit.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string; statementId: string }> },
) {
  try {
    const ctx = await requireWorkspace("cards", "write");
    if (!canEditStatements(ctx.role)) {
      return NextResponse.json(
        { error: "Only Owners or Admins can regenerate statements." },
        { status: 403 },
      );
    }
    const session = await auth();
    const { id, statementId } = await context.params;

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
    if (!canModifyRecord(session, card)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const stmt = await prisma.cardStatement.findUnique({
      where: { id: statementId },
      select: {
        id: true,
        accountId: true,
        workspaceId: true,
        periodStart: true,
        periodEnd: true,
      },
    });
    if (
      !stmt ||
      stmt.workspaceId !== ctx.workspaceId ||
      stmt.accountId !== card.accountId
    ) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const account = await prisma.account.findUnique({
      where: { id: stmt.accountId },
      select: { gracePeriod: true },
    });
    const grace = account?.gracePeriod ?? 0;

    const totalDue = await computeStatementTotalDue(
      stmt.accountId,
      stmt.periodStart,
      stmt.periodEnd,
    );
    const dueDate = new Date(stmt.periodEnd.getTime() + grace * ONE_DAY_MS);

    await prisma.cardStatement.update({
      where: { id: statementId },
      data: {
        totalDue,
        dueDate,
        manuallyEdited: false,
        manuallyEditedAt: null,
        manuallyEditedById: null,
      },
    });

    await recomputeStatementPaidAt(statementId);

    const updated = await prisma.cardStatement.findUnique({
      where: { id: statementId },
      select: {
        id: true,
        totalDue: true,
        dueDate: true,
        paidAt: true,
        manuallyEdited: true,
      },
    });
    return NextResponse.json({
      statement: updated && {
        id: updated.id,
        totalDue: Number(updated.totalDue),
        dueDate: updated.dueDate.toISOString(),
        paidAt: updated.paidAt?.toISOString() ?? null,
        manuallyEdited: updated.manuallyEdited,
      },
    });
  } catch (e) {
    return err(e);
  }
}
