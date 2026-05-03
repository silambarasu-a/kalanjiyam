import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireWorkspace("members", "read");
    const { id } = await context.params;

    const member = await prisma.contact.findUnique({ where: { id } });
    if (!member || member.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const [charges, transfers, expenses, loans] = await Promise.all([
      prisma.memberCharge.findMany({
        where: { workspaceId: ctx.workspaceId, beneficiaryContactId: id },
        orderBy: { createdAt: "desc" },
        include: {
          originTransaction: { select: { id: true, description: true, date: true } },
          settlements: { orderBy: { paidAt: "desc" } },
        },
      }),
      prisma.transfer.findMany({
        where: {
          workspaceId: ctx.workspaceId,
          OR: [{ fromContactId: id }, { toContactId: id }],
        },
        orderBy: { date: "desc" },
        include: {
          fromAccount: { select: { id: true, name: true } },
          toAccount: { select: { id: true, name: true } },
        },
      }),
      // Spent-on-behalf expenses that the user is NOT recovering. Recoverable
      // ones already appear via the Charges list (originTransaction).
      prisma.transaction.findMany({
        where: {
          workspaceId: ctx.workspaceId,
          beneficiaryContactId: id,
          type: "EXPENSE",
          memberChargeType: { in: ["NONE", "GIFT"] },
        },
        orderBy: { date: "desc" },
        select: {
          id: true,
          amount: true,
          date: true,
          description: true,
          memberChargeType: true,
          account: { select: { id: true, name: true } },
          card: { select: { id: true, name: true } },
        },
      }),
      // Hand loans where this contact is the lender (i.e. money you
      // borrowed from them and still owe back).
      prisma.loan.findMany({
        where: { workspaceId: ctx.workspaceId, lenderContactId: id },
        orderBy: [{ active: "desc" }, { startedAt: "desc" }],
        select: {
          id: true,
          kind: true,
          principal: true,
          outstanding: true,
          startedAt: true,
          nextDueDate: true,
          active: true,
          emiAmount: true,
          interestRate: true,
        },
      }),
    ]);

    const totalOutstanding = charges.reduce(
      (sum, c) => sum + (c.status !== "WRITTEN_OFF" ? Number(c.amount) - Number(c.settledAmount) : 0),
      0
    );
    const totalSettled = charges.reduce((sum, c) => sum + Number(c.settledAmount), 0);

    let sentToContact = 0;
    let receivedFromContact = 0;
    for (const t of transfers) {
      const amt = Number(t.amount);
      if (t.toContactId === id) sentToContact += amt;
      if (t.fromContactId === id) receivedFromContact += amt;
    }
    const netTransferred = round2(sentToContact - receivedFromContact);
    const spentOnThem = expenses.reduce((s, e) => s + Number(e.amount), 0);
    const loansOwed = loans.reduce(
      (s, l) => s + (l.active ? Number(l.outstanding) : 0),
      0,
    );

    return NextResponse.json({
      member: { id: member.id, name: member.name },
      totals: {
        outstanding: round2(totalOutstanding),
        settled: round2(totalSettled),
        sentToContact: round2(sentToContact),
        receivedFromContact: round2(receivedFromContact),
        netTransferred,
        spentOnThem: round2(spentOnThem),
        loansOwed: round2(loansOwed),
      },
      charges: charges.map((c) => ({
        id: c.id,
        amount: Number(c.amount),
        settledAmount: Number(c.settledAmount),
        status: c.status,
        notes: c.notes,
        createdAt: c.createdAt.toISOString(),
        origin: c.originTransaction,
        settlements: c.settlements.map((s) => ({
          id: s.id,
          amount: Number(s.amount),
          paidAt: s.paidAt.toISOString(),
          notes: s.notes,
        })),
      })),
      transfers: transfers.map((t) => ({
        id: t.id,
        amount: Number(t.amount),
        date: t.date.toISOString(),
        notes: t.notes,
        direction: t.toContactId === id ? "TO_CONTACT" : "FROM_CONTACT",
        account:
          t.toContactId === id
            ? t.fromAccount
              ? { id: t.fromAccount.id, name: t.fromAccount.name }
              : null
            : t.toAccount
              ? { id: t.toAccount.id, name: t.toAccount.name }
              : null,
      })),
      expenses: expenses.map((e) => ({
        id: e.id,
        amount: Number(e.amount),
        date: e.date.toISOString(),
        description: e.description,
        kind: e.memberChargeType,
        account: e.account ?? e.card,
      })),
      loans: loans.map((l) => ({
        id: l.id,
        kind: l.kind,
        principal: Number(l.principal),
        outstanding: Number(l.outstanding),
        startedAt: l.startedAt.toISOString(),
        nextDueDate: l.nextDueDate?.toISOString() ?? null,
        active: l.active,
        emiAmount: l.emiAmount == null ? null : Number(l.emiAmount),
        interestRate: l.interestRate == null ? null : Number(l.interestRate),
      })),
    });
  } catch (e) {
    return err(e);
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
