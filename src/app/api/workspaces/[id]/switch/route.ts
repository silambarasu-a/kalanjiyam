import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const membership = await prisma.workspaceMember.findUnique({
    where: {
      workspaceId_userId: { workspaceId: id, userId: session.user.id },
    },
  });
  if (!membership || !membership.acceptedAt) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { activeWorkspaceId: id },
  });

  return NextResponse.json({ ok: true });
}
