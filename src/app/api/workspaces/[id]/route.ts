import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { workspaceUpdateSchema } from "@/lib/validators-workspace";
import { requireMembership, WorkspaceMgmtError } from "@/lib/workspace-guard";
import { TIMING } from "@/lib/timing";

function handleError(err: unknown) {
  if (err instanceof WorkspaceMgmtError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error("[workspaces/[id]]", err);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const ctx = await requireMembership(id);
    const ws = await prisma.workspace.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, name: true, email: true } },
        _count: { select: { members: true } },
      },
    });
    if (!ws) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({
      workspace: {
        id: ws.id,
        name: ws.name,
        owner: ws.owner,
        memberCount: ws._count.members,
        transactionEditWindowDays: ws.transactionEditWindowDays,
        // Surface the env default so the UI can show "(default: N days)"
        // alongside the per-workspace override.
        editWindowDefaultDays: TIMING.defaultEditWindowDays,
        createdAt: ws.createdAt.toISOString(),
        role: ctx.role,
      },
    });
  } catch (err) {
    return handleError(err);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    await requireMembership(id, ["OWNER", "ADMIN"]);
    const body = await request.json();
    const parsed = workspaceUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const ws = await prisma.workspace.update({
      where: { id },
      data: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.transactionEditWindowDays !== undefined
          ? { transactionEditWindowDays: parsed.data.transactionEditWindowDays }
          : {}),
      },
    });
    return NextResponse.json({
      id: ws.id,
      name: ws.name,
      transactionEditWindowDays: ws.transactionEditWindowDays,
    });
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
