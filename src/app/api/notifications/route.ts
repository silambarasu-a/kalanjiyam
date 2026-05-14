import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { untaggedPaymentsToCard } from "@/lib/card-statement-service";

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
  /** Original bill total — only set on CARD_STATEMENT entries that have
   * been partially paid, so the UI can render "X paid of Y". */
  total?: number;
  paid?: number;
  href: string;
  /** Deep link that opens the relevant Pay/Confirm dialog on the detail
   * page. Absent only when the due type has no flow we can deep-link
   * into. UI shows a "Pay" button when present. */
  payHref?: string;
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
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const nextMonthStart = new Date(today.getFullYear(), today.getMonth() + 1, 1);

    const [reminders, loans, leaseSchedules, statements, cardAccounts, loanPaymentsThisMonth] = await Promise.all([
      prisma.investmentReminder.findMany({
        where: {
          workspaceId: wsId,
          status: "UPCOMING",
          dueDate: { lte: horizon },
        },
        orderBy: { dueDate: "asc" },
        include: {
          investment: { select: { id: true, name: true, kind: true } },
          loan: {
            select: {
              id: true,
              lender: true,
              lenderContact: { select: { name: true } },
            },
          },
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
          lenderContact: { select: { name: true } },
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
      // Loan payments posted this calendar month. Used to mark a loan
      // notification as Paid once cumulative payments cover the EMI.
      prisma.transaction.findMany({
        where: {
          workspaceId: wsId,
          type: "EXPENSE",
          kind: "LOAN_PAYMENT",
          date: { gte: monthStart, lt: nextMonthStart },
          transferId: null,
        },
        select: { loanId: true, amount: true },
      }),
    ]);

    const loanPaidByLoanId = new Map<string, number>();
    for (const t of loanPaymentsThisMonth) {
      if (!t.loanId) continue;
      loanPaidByLoanId.set(
        t.loanId,
        (loanPaidByLoanId.get(t.loanId) ?? 0) + Number(t.amount),
      );
    }

    const items: Notification[] = [];
    for (const r of reminders) {
      const label =
        r.investment?.name ??
        r.loan?.lenderContact?.name ??
        r.loan?.lender ??
        r.kind.replace(/_/g, " ");
      items.push({
        id: `reminder:${r.id}`,
        source: "REMINDER",
        kind: r.kind,
        label,
        dueDate: r.dueDate.toISOString(),
        amount: r.amount == null ? null : Number(r.amount),
        href: "/reminders",
        payHref: `/reminders?confirm=${r.id}`,
        overdue: r.dueDate < today,
      });
    }
    for (const l of loans) {
      if (!l.nextDueDate) continue;
      const emi = l.emiAmount == null ? null : Number(l.emiAmount);
      // Only credit a current-month LOAN_PAYMENT against an EMI when the
      // EMI's own due date is in the current month OR overdue. After
      // last month's EMI was paid, the loan's `nextDueDate` auto-rolls
      // forward into next month — without this gate the just-paid
      // current-month payment was being subtracted from the next-month
      // EMI, making the upcoming due look already-paid. Overdue EMIs
      // are still allowed to show partial-payment progress.
      const dueNotInFutureMonth = l.nextDueDate < nextMonthStart;
      const paidThisMonth = dueNotInFutureMonth
        ? loanPaidByLoanId.get(l.id) ?? 0
        : 0;
      const outstanding =
        emi == null ? null : Math.max(0, emi - paidThisMonth);
      items.push({
        id: `loan:${l.id}`,
        source: "LOAN",
        kind: l.source,
        label: l.lenderContact?.name ?? l.lender,
        dueDate: l.nextDueDate.toISOString(),
        amount: outstanding,
        ...(emi != null && paidThisMonth > 0
          ? { total: emi, paid: Math.min(emi, paidThisMonth) }
          : {}),
        href: `/loans/${l.id}`,
        payHref: `/loans/${l.id}?pay=1`,
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
        payHref: `/leases/${s.lease.id}?confirm=${s.id}`,
        overdue: s.dueDate < today,
      });
    }
    // Card statements — outstanding = totalDue − Σ payments. Skip rows
    // already paid in full. Only mark the account when we actually emit
    // a notification — a cleared statement shouldn't suppress a separate
    // manual override for a future bill.
    const accountsWithStatement = new Set<string>();
    for (const s of statements) {
      const paid = s.payments.reduce((a, p) => a + Number(p.amount), 0);
      const total = Number(s.totalDue);
      const outstanding = Math.max(0, total - paid);
      if (outstanding === 0) continue;
      accountsWithStatement.add(s.account.id);
      const cardId = s.account.linkedCard?.id ?? null;
      const cardHref = cardId ? `/cards/${cardId}` : "/cards";
      items.push({
        id: `card-statement:${s.id}`,
        source: "CARD_STATEMENT",
        kind: "CARD_BILL",
        label: s.account.name,
        dueDate: s.dueDate.toISOString(),
        amount: round2(outstanding),
        ...(paid > 0
          ? { total: round2(total), paid: round2(Math.min(total, paid)) }
          : {}),
        href: cardHref,
        ...(cardId ? { payHref: `${cardHref}?pay=1` } : {}),
        overdue: s.dueDate < today,
      });
    }
    // Manual-override card bills for accounts without a materialised stmt.
    // Subtract untagged transfers landing on the account so partial
    // payments toward the override show through.
    for (const a of cardAccounts) {
      if (accountsWithStatement.has(a.id)) continue;
      if (!a.nextBillDue || a.nextBillAmount == null) continue;
      const amount = Number(a.nextBillAmount);
      if (amount <= 0) continue;
      const paidUntagged = await untaggedPaymentsToCard(a.id, a.nextBillDue);
      const outstanding = Math.max(0, amount - paidUntagged);
      if (outstanding === 0) continue;
      const cardId = a.linkedCard?.id ?? null;
      const cardHref = cardId ? `/cards/${cardId}` : "/cards";
      items.push({
        id: `card-manual:${a.id}`,
        source: "CARD_STATEMENT",
        kind: "CARD_BILL",
        label: a.name,
        dueDate: a.nextBillDue.toISOString(),
        amount: round2(outstanding),
        ...(paidUntagged > 0
          ? {
              total: round2(amount),
              paid: round2(Math.min(amount, paidUntagged)),
            }
          : {}),
        href: cardHref,
        ...(cardId ? { payHref: `${cardHref}?pay=1` } : {}),
        overdue: a.nextBillDue < today,
      });
    }

    // Visibility window: current-month + overdue items always show.
    // Next-month items only surface during the last week of the current
    // calendar month (matches `isNearMonthEnd` on the dashboard tile —
    // both surfaces flip together so the popover and dashboard agree).
    const daysInThisMonth = new Date(
      today.getFullYear(),
      today.getMonth() + 1,
      0,
    ).getDate();
    const isNearMonthEnd = today.getDate() > daysInThisMonth - 7;
    const visibleItems = isNearMonthEnd
      ? items
      : items.filter((i) => new Date(i.dueDate) < nextMonthStart);
    visibleItems.sort((a, b) => a.dueDate.localeCompare(b.dueDate));

    const overdueCount = visibleItems.filter((i) => i.overdue).length;
    return NextResponse.json({
      items: visibleItems,
      counts: {
        total: visibleItems.length,
        overdue: overdueCount,
        dueSoon: visibleItems.length - overdueCount,
      },
    });
  } catch (e) {
    return err(e);
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
