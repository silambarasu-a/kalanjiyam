import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { familyUpdateSchema } from "@/lib/validators-domain";

function error(err: unknown) {
  if (err instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireWorkspace("family", "write");
    const { id } = await context.params;
    const body = await request.json();
    const parsed = familyUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const existing = await prisma.familyMember.findUnique({ where: { id } });
    if (!existing || existing.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const member = await prisma.familyMember.update({
      where: { id },
      data: {
        name: parsed.data.name ?? existing.name,
        relationship: parsed.data.relationship ?? existing.relationship,
        dob: parsed.data.dob ? new Date(parsed.data.dob) : existing.dob,
        notes: parsed.data.notes ?? existing.notes,
        active: parsed.data.active ?? existing.active,
        userId: parsed.data.userId ?? existing.userId,
      },
    });
    return NextResponse.json({ id: member.id });
  } catch (err) {
    return error(err);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireWorkspace("family", "write");
    const { id } = await context.params;
    const existing = await prisma.familyMember.findUnique({ where: { id } });
    if (!existing || existing.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    await prisma.familyMember.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return error(err);
  }
}
