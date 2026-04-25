import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { ReminderKind, ReminderStatus } from "@/generated/prisma/client";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const ctx = await requireWorkspace("reminders", "read");
    const url = new URL(request.url);
    const status = (url.searchParams.get("status") ?? "UPCOMING") as ReminderStatus;
    const kind = url.searchParams.get("kind") as ReminderKind | null;
    const days = Number(url.searchParams.get("days") ?? "365");

    const until = new Date();
    until.setDate(until.getDate() + days);

    const reminders = await prisma.investmentReminder.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        status,
        ...(kind ? { kind } : {}),
        dueDate: { lte: until },
      },
      orderBy: { dueDate: "asc" },
      take: 100,
      include: {
        investment: { select: { id: true, name: true, kind: true, premiumAmount: true } },
      },
    });

    return NextResponse.json({
      reminders: reminders.map((r) => ({
        id: r.id,
        kind: r.kind,
        dueDate: r.dueDate.toISOString(),
        amount: r.amount == null ? null : Number(r.amount),
        status: r.status,
        investment: r.investment
          ? {
              id: r.investment.id,
              name: r.investment.name,
              kind: r.investment.kind,
              premiumAmount:
                r.investment.premiumAmount == null ? null : Number(r.investment.premiumAmount),
            }
          : null,
      })),
    });
  } catch (e) {
    return err(e);
  }
}
