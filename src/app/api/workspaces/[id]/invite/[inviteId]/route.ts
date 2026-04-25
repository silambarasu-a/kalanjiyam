import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireMembership, WorkspaceMgmtError } from "@/lib/workspace-guard";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; inviteId: string }> }
) {
  try {
    const { id, inviteId } = await context.params;
    await requireMembership(id, ["OWNER", "ADMIN"]);
    const invite = await prisma.workspaceInvite.findUnique({ where: { id: inviteId } });
    if (!invite || invite.workspaceId !== id) {
      return NextResponse.json({ error: "Invite not found" }, { status: 404 });
    }
    if (invite.acceptedAt) {
      return NextResponse.json({ error: "Invite already accepted" }, { status: 409 });
    }
    await prisma.workspaceInvite.update({
      where: { id: inviteId },
      data: { cancelledAt: new Date() },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof WorkspaceMgmtError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
