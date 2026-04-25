import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";

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
    const ctx = await requireWorkspace("hand_loans", "write");
    const { id } = await context.params;
    const entry = await prisma.handLoanEntry.findUnique({
      where: { id },
      include: { member: { select: { workspaceId: true } } },
    });
    if (!entry || entry.member.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    await prisma.$transaction(async (tx) => {
      if (entry.transactionId) {
        await tx.transaction.delete({ where: { id: entry.transactionId } }).catch(() => {});
      }
      await tx.handLoanEntry.delete({ where: { id } });
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}
