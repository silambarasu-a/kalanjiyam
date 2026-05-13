import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function GET() {
  try {
    const ctx = await requireWorkspace("reminders", "read");
    const count = await prisma.notification.count({
      where: {
        workspaceId: ctx.workspaceId,
        OR: [{ userId: ctx.userId }, { userId: null }],
        readAt: null,
      },
    });
    return NextResponse.json({ count });
  } catch (e) {
    return err(e);
  }
}
