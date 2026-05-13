import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { NotificationKind } from "@/generated/prisma/client";
import { z } from "zod";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[settings/email-prefs]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

const ALL_KINDS = Object.values(NotificationKind) as NotificationKind[];

const emailPrefsSchema = z.object({
  enabled: z.boolean(),
  /** Allow-list of notification kinds. Empty = all kinds when enabled. */
  kinds: z.array(z.enum(ALL_KINDS as [string, ...string[]])).optional(),
});

export async function GET() {
  try {
    const ctx = await requireWorkspace("settings", "read");
    const member = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: { workspaceId: ctx.workspaceId, userId: ctx.userId },
      },
      select: { emailPrefs: true },
    });
    return NextResponse.json({ emailPrefs: member?.emailPrefs ?? {} });
  } catch (e) {
    return err(e);
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireWorkspace("settings", "write");
    const body = await request.json();
    const parsed = emailPrefsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    await prisma.workspaceMember.update({
      where: {
        workspaceId_userId: { workspaceId: ctx.workspaceId, userId: ctx.userId },
      },
      data: { emailPrefs: parsed.data },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}
