import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { workspaceCreateSchema } from "@/lib/validators-workspace";
import { WorkspaceRole } from "@/generated/prisma/client";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const memberships = await prisma.workspaceMember.findMany({
    where: { userId: session.user.id, acceptedAt: { not: null } },
    include: { workspace: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({
    workspaces: memberships.map((m) => ({
      id: m.workspace.id,
      name: m.workspace.name,
      role: m.role,
    })),
    cap: 3,
  });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json();
  const parsed = workspaceCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const count = await prisma.workspaceMember.count({
    where: { userId: session.user.id, acceptedAt: { not: null } },
  });
  if (count >= 3) {
    return NextResponse.json(
      { error: "You already belong to 3 workspaces. Leave one first." },
      { status: 400 }
    );
  }

  const workspace = await prisma.$transaction(async (tx) => {
    const ws = await tx.workspace.create({
      data: { name: parsed.data.name, ownerUserId: session.user.id },
    });
    await tx.workspaceMember.create({
      data: {
        workspaceId: ws.id,
        userId: session.user.id,
        role: WorkspaceRole.OWNER,
        acceptedAt: new Date(),
      },
    });
    return ws;
  });

  return NextResponse.json({ id: workspace.id, name: workspace.name, role: "OWNER" });
}
