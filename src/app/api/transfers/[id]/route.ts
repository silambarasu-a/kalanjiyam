import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { canModifyRecord } from "@/lib/permissions";

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
      include: { fromAccount: { select: { ownerUserId: true, sharedWithUserIds: true } } },
    });
    if (!transfer || transfer.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (
      !canModifyRecord(session, {
        ownerUserId: transfer.userId,
        sharedWithUserIds: transfer.fromAccount?.sharedWithUserIds ?? [],
      })
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    // Cascade: legs reference transferId with onDelete: Cascade.
    await prisma.transfer.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}
