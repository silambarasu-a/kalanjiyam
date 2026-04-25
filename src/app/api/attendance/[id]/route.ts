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
    const row = await prisma.attendance.findUnique({
      where: { id },
      include: { worker: { select: { workspaceId: true } } },
    });
    if (!row || row.worker.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    await prisma.attendance.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}
