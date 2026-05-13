import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[inbox]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const ctx = await requireWorkspace("reminders", "read");
    const url = new URL(request.url);
    const filter = url.searchParams.get("filter") ?? "all"; // all | unread
    const take = Math.min(
      100,
      Math.max(1, Number(url.searchParams.get("take") ?? 50)),
    );

    const rows = await prisma.notification.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        OR: [{ userId: ctx.userId }, { userId: null }],
        ...(filter === "unread" ? { readAt: null } : {}),
      },
      orderBy: { createdAt: "desc" },
      take,
    });
    return NextResponse.json({
      notifications: rows.map((n) => ({
        id: n.id,
        kind: n.kind,
        title: n.title,
        body: n.body,
        link: n.link,
        readAt: n.readAt?.toISOString() ?? null,
        emailedAt: n.emailedAt?.toISOString() ?? null,
        createdAt: n.createdAt.toISOString(),
      })),
    });
  } catch (e) {
    return err(e);
  }
}

export async function POST(request: Request) {
  // Action: mark-all-read (POST /api/inbox with { action: "mark-all-read" }).
  // Per-row read uses PATCH /api/inbox/[id].
  try {
    const ctx = await requireWorkspace("reminders", "write");
    const body = await request.json().catch(() => ({}));
    if (body?.action === "mark-all-read") {
      const now = new Date();
      await prisma.notification.updateMany({
        where: {
          workspaceId: ctx.workspaceId,
          OR: [{ userId: ctx.userId }, { userId: null }],
          readAt: null,
        },
        data: { readAt: now },
      });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return err(e);
  }
}
