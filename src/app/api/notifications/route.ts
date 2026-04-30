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
  source: "REMINDER" | "LOAN" | "LEASE" | "CARD_STATEMENT";
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

    const [reminders, loans, leaseSchedules, statements, cardAccounts] = await Promise.all([
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
      // Materialised credit-card statements that are unpaid and due within
      // the horizon. We include payments to compute outstanding (statement
      // can be partially paid).
      prisma.cardStatement.findMany({
        where: {
          workspaceId: wsId,
          paidAt: null,
          dueDate: { lte: horizon },
        },
        orderBy: { dueDate: "asc" },
        take: 30,
        include: {
          account: {
            select: { id: true, name: true, linkedCard: { select: { id: true } } },
          },
          payments: { select: { amount: true } },
        },
      }),
      // Manual-override path for CARD accounts that have a billing cycle
      // configured but no materialised statement yet. Mirrors the dashboard.
      prisma.account.findMany({
        where: {
          workspaceId: wsId,
          active: true,
          kind: "CARD",
          nextBillDue: { not: null, lte: horizon },
          nextBillAmount: { gt: 0 },
        },
        select: {
          id: true,
          name: true,
          nextBillDue: true,
          nextBillAmount: true,
          linkedCard: { select: { id: true } },
        },
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
    // Card statements — outstanding = totalDue − Σ payments. Skip rows
    // already paid in full.
    const accountsWithStatement = new Set<string>();
    for (const s of statements) {
      const paid = s.payments.reduce((a, p) => a + Number(p.amount), 0);
      const outstanding = Math.max(0, Number(s.totalDue) - paid);
      accountsWithStatement.add(s.account.id);
      if (outstanding === 0) continue;
      const cardId = s.account.linkedCard?.id ?? null;
      items.push({
        id: `card-statement:${s.id}`,
        source: "CARD_STATEMENT",
        kind: "CARD_BILL",
        label: s.account.name,
        dueDate: s.dueDate.toISOString(),
        amount: round2(outstanding),
        href: cardId ? `/cards/${cardId}` : "/cards",
        overdue: s.dueDate < today,
      });
    }
    // Manual-override card bills for accounts without a materialised stmt.
    for (const a of cardAccounts) {
      if (accountsWithStatement.has(a.id)) continue;
      if (!a.nextBillDue || a.nextBillAmount == null) continue;
      const amount = Number(a.nextBillAmount);
      if (amount <= 0) continue;
      const cardId = a.linkedCard?.id ?? null;
      items.push({
        id: `card-manual:${a.id}`,
        source: "CARD_STATEMENT",
        kind: "CARD_BILL",
        label: a.name,
        dueDate: a.nextBillDue.toISOString(),
        amount: round2(amount),
        href: cardId ? `/cards/${cardId}` : "/cards",
        overdue: a.nextBillDue < today,
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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
