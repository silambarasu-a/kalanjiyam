import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { familyCreateSchema } from "@/lib/validators-domain";

function error(err: unknown) {
  if (err instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error("[family]", err);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function GET() {
  try {
    const ctx = await requireWorkspace("family", "read");
    const members = await prisma.familyMember.findMany({
      where: { workspaceId: ctx.workspaceId },
      orderBy: [{ active: "desc" }, { name: "asc" }],
      include: { user: { select: { id: true, email: true, name: true } } },
    });
    return NextResponse.json({
      members: members.map((m) => ({
        id: m.id,
        name: m.name,
        relationship: m.relationship,
        dob: m.dob?.toISOString() ?? null,
        notes: m.notes,
        active: m.active,
        linkedUser: m.user ? { id: m.user.id, email: m.user.email, name: m.user.name } : null,
      })),
    });
  } catch (err) {
    return error(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireWorkspace("family", "write");
    const body = await request.json();
    const parsed = familyCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const member = await prisma.familyMember.create({
      data: {
        workspaceId: ctx.workspaceId,
        name: parsed.data.name,
        relationship: parsed.data.relationship,
        dob: parsed.data.dob ? new Date(parsed.data.dob) : null,
        notes: parsed.data.notes,
        userId: parsed.data.userId ?? null,
      },
    });
    return NextResponse.json({ id: member.id });
  } catch (err) {
    return error(err);
  }
}
