import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[inbox/:id]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireWorkspace("reminders", "write");
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const row = await prisma.notification.findUnique({ where: { id } });
    if (
      !row ||
      row.workspaceId !== ctx.workspaceId ||
      (row.userId !== null && row.userId !== ctx.userId)
    ) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const readAt =
      body.read === false
        ? null
        : (row.readAt ?? new Date());
    const updated = await prisma.notification.update({
      where: { id },
      data: { readAt },
    });
    return NextResponse.json({ id: updated.id, readAt: updated.readAt });
  } catch (e) {
    return err(e);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireWorkspace("reminders", "write");
    const { id } = await context.params;
    const row = await prisma.notification.findUnique({ where: { id } });
    if (
      !row ||
      row.workspaceId !== ctx.workspaceId ||
      (row.userId !== null && row.userId !== ctx.userId)
    ) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    await prisma.notification.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}
