import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireMembership, WorkspaceMgmtError } from "@/lib/workspace-guard";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    await requireMembership(id);

    const [members, invites] = await Promise.all([
      prisma.workspaceMember.findMany({
        where: { workspaceId: id, acceptedAt: { not: null } },
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: "asc" },
      }),
      prisma.workspaceInvite.findMany({
        where: { workspaceId: id, acceptedAt: null, cancelledAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    return NextResponse.json({
      members: members.map((m) => ({
        id: m.id,
        userId: m.user.id,
        name: m.user.name,
        email: m.user.email,
        role: m.role,
        permissions: m.permissions ?? {},
      })),
      invites: invites.map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role,
        expiresAt: i.expiresAt.toISOString(),
      })),
    });
  } catch (err) {
    if (err instanceof WorkspaceMgmtError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[members GET]", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
