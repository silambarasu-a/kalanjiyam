import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { checkDayWindowEditAllowed } from "@/lib/transaction-edit-lock";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function DELETE(
  request: Request,
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
    // Edit-window guard. DELETE uses ?force=1 since there's no body.
    const force = new URL(request.url).searchParams.get("force") === "1";
    const lock = await checkDayWindowEditAllowed({
      date: row.date,
      workspaceId: ctx.workspaceId,
      role: ctx.role,
      force,
      entityName: "attendance entry",
    });
    if (!lock.ok) {
      return NextResponse.json(
        { error: lock.message, canForce: lock.canForce },
        { status: lock.status },
      );
    }
    await prisma.attendance.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}
