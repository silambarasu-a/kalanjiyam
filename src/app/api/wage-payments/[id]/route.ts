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
    const ctx = await requireWorkspace("wages", "write");
    const { id } = await context.params;
    const payment = await prisma.wagePayment.findUnique({
      where: { id },
      include: { worker: { select: { workspaceId: true } } },
    });
    if (!payment || payment.worker.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    await prisma.$transaction(async (tx) => {
      if (payment.transactionId) {
        await tx.transaction.delete({ where: { id: payment.transactionId } }).catch(() => {});
      }
      await tx.wagePayment.delete({ where: { id } });
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}
