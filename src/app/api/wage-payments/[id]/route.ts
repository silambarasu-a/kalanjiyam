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
        // The linked transaction may have already been deleted by the
        // user via the transactions list — that's expected, so we
        // tolerate "record not found" here. Anything else gets logged
        // so it's traceable in Vercel logs without surfacing as a
        // user-facing failure (the wage payment is the primary record
        // we're deleting).
        await tx.transaction
          .delete({ where: { id: payment.transactionId } })
          .catch((e) =>
            console.error("[wage-payments/delete] linked txn cleanup", e),
          );
      }
      await tx.wagePayment.delete({ where: { id } });
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}
