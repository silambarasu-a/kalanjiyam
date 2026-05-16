import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { canModifyRecord } from "@/lib/permissions";
import { cardStatementEditSchema } from "@/lib/validators-domain";
import { recomputeStatementPaidAt } from "@/lib/card-statement-service";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[card-statement-edit]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

function canEditStatements(role: string): boolean {
  return role === "OWNER" || role === "ADMIN" || role === "SUPER_ADMIN";
}

/**
 * Hand-correct a materialised CardStatement's totalDue and/or dueDate.
 * Marks the row as manuallyEdited so the materializer leaves it alone
 * on subsequent runs. Recomputes paidAt because changing totalDue can
 * retroactively pay or un-pay the bill.
 *
 * Restricted to OWNER / ADMIN / SUPER_ADMIN — matches the closed-statement
 * transaction edit-lock policy.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; statementId: string }> },
) {
  try {
    const ctx = await requireWorkspace("cards", "write");
    if (!canEditStatements(ctx.role)) {
      return NextResponse.json(
        { error: "Only Owners or Admins can edit statements." },
        { status: 403 },
      );
    }
    const session = await auth();
    const { id, statementId } = await context.params;

    const body = await request.json();
    const parsed = cardStatementEditSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }

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
        closedAt: true,
      },
    });
    if (
      !stmt ||
      stmt.workspaceId !== ctx.workspaceId ||
      stmt.accountId !== card.accountId
    ) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!stmt.closedAt) {
      return NextResponse.json(
        { error: "Only materialised (closed) statements can be edited." },
        { status: 400 },
      );
    }

    let dueDate: Date | undefined;
    if (parsed.data.dueDate !== undefined) {
      const d = new Date(parsed.data.dueDate);
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json({ error: "Invalid dueDate" }, { status: 400 });
      }
      dueDate = d;
    }

    await prisma.cardStatement.update({
      where: { id: statementId },
      data: {
        ...(parsed.data.totalDue !== undefined
          ? { totalDue: parsed.data.totalDue }
          : {}),
        ...(dueDate ? { dueDate } : {}),
        manuallyEdited: true,
        manuallyEditedAt: new Date(),
        manuallyEditedById: ctx.userId,
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
        manuallyEditedAt: true,
      },
    });
    return NextResponse.json({
      statement: updated && {
        id: updated.id,
        totalDue: Number(updated.totalDue),
        dueDate: updated.dueDate.toISOString(),
        paidAt: updated.paidAt?.toISOString() ?? null,
        manuallyEdited: updated.manuallyEdited,
        manuallyEditedAt: updated.manuallyEditedAt?.toISOString() ?? null,
      },
    });
  } catch (e) {
    return err(e);
  }
}
