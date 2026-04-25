import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { ReminderStatus } from "@/generated/prisma/client";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireWorkspace("reminders", "write");
    const { id } = await context.params;
    const reminder = await prisma.investmentReminder.findUnique({ where: { id } });
    if (!reminder || reminder.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (reminder.status !== "UPCOMING") {
      return NextResponse.json({ error: "Already processed" }, { status: 400 });
    }
    await prisma.investmentReminder.update({
      where: { id },
      data: { status: ReminderStatus.SKIPPED },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}
