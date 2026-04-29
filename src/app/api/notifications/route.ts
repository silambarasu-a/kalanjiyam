import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[notifications]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export type Notification = {
  id: string;
  source: "REMINDER" | "LOAN" | "LEASE";
  kind: string;
  label: string;
  dueDate: string;
  amount: number | null;
  href: string;
  overdue: boolean;
};

export async function GET(request: Request) {
  try {
    const ctx = await requireWorkspace("reminders", "read");
    const wsId = ctx.workspaceId;
    const url = new URL(request.url);
    // Lookahead window. Popover defaults to 30; the full notifications page
    // can pass ?days=90 / 365 to widen.
    const daysRaw = Number(url.searchParams.get("days"));
    const days =
      Number.isFinite(daysRaw) && daysRaw > 0 && daysRaw <= 730 ? daysRaw : 30;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const horizon = new Date(today);
    horizon.setDate(horizon.getDate() + days);

    const [reminders, loans, leaseSchedules] = await Promise.all([
      prisma.investmentReminder.findMany({
        where: {
          workspaceId: wsId,
          status: "UPCOMING",
          dueDate: { lte: horizon },
        },
        orderBy: { dueDate: "asc" },
        include: {
          investment: { select: { id: true, name: true, kind: true } },
          loan: { select: { id: true, lender: true } },
        },
        take: 50,
      }),
      prisma.loan.findMany({
        where: {
          workspaceId: wsId,
          active: true,
          nextDueDate: { not: null, lte: horizon },
        },
        orderBy: { nextDueDate: "asc" },
        select: {
          id: true,
          lender: true,
          nextDueDate: true,
          emiAmount: true,
          source: true,
        },
        take: 50,
      }),
      prisma.leasePaymentSchedule.findMany({
        where: {
          lease: { workspaceId: wsId, active: true },
          status: "UPCOMING",
          dueDate: { lte: horizon },
        },
        orderBy: { dueDate: "asc" },
        include: {
          lease: { select: { id: true, lessorName: true, lesseeName: true, direction: true } },
        },
        take: 50,
      }),
    ]);

    const items: Notification[] = [];
    for (const r of reminders) {
      const label =
        r.investment?.name ?? r.loan?.lender ?? r.kind.replace(/_/g, " ");
      items.push({
        id: `reminder:${r.id}`,
        source: "REMINDER",
        kind: r.kind,
        label,
        dueDate: r.dueDate.toISOString(),
        amount: r.amount == null ? null : Number(r.amount),
        href: "/reminders",
        overdue: r.dueDate < today,
      });
    }
    for (const l of loans) {
      if (!l.nextDueDate) continue;
      items.push({
        id: `loan:${l.id}`,
        source: "LOAN",
        kind: l.source,
        label: l.lender,
        dueDate: l.nextDueDate.toISOString(),
        amount: l.emiAmount == null ? null : Number(l.emiAmount),
        href: `/loans/${l.id}`,
        overdue: l.nextDueDate < today,
      });
    }
    for (const s of leaseSchedules) {
      const counterparty =
        s.lease.direction === "LEASED_OUT" ? s.lease.lesseeName : s.lease.lessorName;
      items.push({
        id: `lease:${s.id}`,
        source: "LEASE",
        kind: s.lease.direction,
        label: counterparty ?? "Lease payment",
        dueDate: s.dueDate.toISOString(),
        amount: s.amount == null ? null : Number(s.amount),
        href: `/leases/${s.lease.id}`,
        overdue: s.dueDate < today,
      });
    }

    items.sort((a, b) => a.dueDate.localeCompare(b.dueDate));

    const overdueCount = items.filter((i) => i.overdue).length;
    return NextResponse.json({
      items,
      counts: {
        total: items.length,
        overdue: overdueCount,
        dueSoon: items.length - overdueCount,
      },
    });
  } catch (e) {
    return err(e);
  }
}
