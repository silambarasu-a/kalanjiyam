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
  context: { params: Promise<{ id: string; scheduleId: string }> }
) {
  try {
    const ctx = await requireWorkspace("leases", "write");
    const { id, scheduleId } = await context.params;
    const lease = await prisma.lease.findUnique({ where: { id } });
    if (!lease || lease.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Lease not found" }, { status: 404 });
    }
    const schedule = await prisma.leasePaymentSchedule.findUnique({
      where: { id: scheduleId },
    });
    if (!schedule || schedule.leaseId !== id) {
      return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
    }
    if (schedule.status !== "UPCOMING") {
      return NextResponse.json({ error: `Cannot skip a ${schedule.status} row` }, { status: 400 });
    }
    await prisma.leasePaymentSchedule.update({
      where: { id: scheduleId },
      data: { status: ReminderStatus.SKIPPED },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}
