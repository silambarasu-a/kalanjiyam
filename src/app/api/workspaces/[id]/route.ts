import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { workspaceRenameSchema } from "@/lib/validators-workspace";
import { requireMembership, WorkspaceMgmtError } from "@/lib/workspace-guard";

function handleError(err: unknown) {
  if (err instanceof WorkspaceMgmtError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error("[workspaces/[id]]", err);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    await requireMembership(id, ["OWNER", "ADMIN"]);
    const body = await request.json();
    const parsed = workspaceRenameSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const ws = await prisma.workspace.update({
      where: { id },
      data: { name: parsed.data.name },
    });
    return NextResponse.json({ id: ws.id, name: ws.name });
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const ctx = await requireMembership(id, ["OWNER"]);
    // Cascade deletes wipe every workspace-scoped row.
    await prisma.workspace.delete({ where: { id } });
    await prisma.user.updateMany({
      where: { activeWorkspaceId: id },
      data: { activeWorkspaceId: null },
    });
    return NextResponse.json({ ok: true, workspaceId: ctx.workspaceId });
  } catch (err) {
    return handleError(err);
  }
}
