import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { memberUpdateSchema } from "@/lib/validators-workspace";
import { requireMembership, WorkspaceMgmtError } from "@/lib/workspace-guard";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; memberId: string }> }
) {
  try {
    const { id, memberId } = await context.params;
    const ctx = await requireMembership(id, ["OWNER", "ADMIN"]);
    const body = await request.json();
    const parsed = memberUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const target = await prisma.workspaceMember.findUnique({ where: { id: memberId } });
    if (!target || target.workspaceId !== id) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }
    if (target.role === "OWNER") {
      return NextResponse.json({ error: "Cannot modify the workspace owner." }, { status: 400 });
    }
    // Only OWNER can promote to ADMIN.
    if (parsed.data.role === "ADMIN" && ctx.role !== "OWNER") {
      return NextResponse.json(
        { error: "Only the workspace owner can assign Admin." },
        { status: 403 }
      );
    }
    const updated = await prisma.workspaceMember.update({
      where: { id: memberId },
      data: {
        role: parsed.data.role ?? target.role,
        permissions: parsed.data.permissions ?? (target.permissions as object) ?? {},
      },
    });
    return NextResponse.json({
      id: updated.id,
      role: updated.role,
      permissions: updated.permissions,
    });
  } catch (err) {
    if (err instanceof WorkspaceMgmtError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; memberId: string }> }
) {
  try {
    const { id, memberId } = await context.params;
    const ctx = await requireMembership(id, ["OWNER", "ADMIN"]);
    const target = await prisma.workspaceMember.findUnique({ where: { id: memberId } });
    if (!target || target.workspaceId !== id) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }
    if (target.role === "OWNER") {
      return NextResponse.json({ error: "The workspace owner cannot be removed." }, { status: 400 });
    }
    if (target.role === "ADMIN" && ctx.role !== "OWNER") {
      return NextResponse.json(
        { error: "Only the workspace owner can remove Admins." },
        { status: 403 }
      );
    }
    await prisma.$transaction([
      prisma.workspaceMember.delete({ where: { id: memberId } }),
      prisma.user.updateMany({
        where: { id: target.userId, activeWorkspaceId: id },
        data: { activeWorkspaceId: null },
      }),
    ]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof WorkspaceMgmtError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
