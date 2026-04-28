import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { canModifyRecord } from "@/lib/permissions";
import { recomputeStatementPaidAt } from "@/lib/card-statement-service";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireWorkspace("transfers", "write");
    const session = await auth();
    const { id } = await context.params;
    const transfer = await prisma.transfer.findUnique({
      where: { id },
      include: {
        fromAccount: { select: { sharedWithUserIds: true } },
        toAccount: { select: { sharedWithUserIds: true } },
      },
    });
    if (!transfer || transfer.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    // Either side's account-shared users can modify; one side may be a
    // member (no account row), so merge both lists and tolerate null.
    const sharedWithUserIds = [
      ...(transfer.fromAccount?.sharedWithUserIds ?? []),
      ...(transfer.toAccount?.sharedWithUserIds ?? []),
    ];
    if (
      !canModifyRecord(session, {
        ownerUserId: transfer.userId,
        sharedWithUserIds,
      })
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    // Capture the statementId before deletion so we can recompute its
    // paidAt afterwards (this transfer might have been the one closing
    // the bill).
    const tagged = transfer.statementId;
    // Cascade: legs reference transferId with onDelete: Cascade.
    await prisma.transfer.delete({ where: { id } });
    if (tagged) {
      await recomputeStatementPaidAt(tagged);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}
