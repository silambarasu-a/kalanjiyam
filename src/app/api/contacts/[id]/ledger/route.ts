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

    const [charges, transfers, expenses, loans, paidForMe] = await Promise.all([
      prisma.memberCharge.findMany({
        where: { workspaceId: ctx.workspaceId, beneficiaryContactId: id },
        orderBy: { createdAt: "desc" },
        include: {
          originSplit: {
            select: {
              transaction: { select: { id: true, description: true, date: true } },
            },
          },
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
      // Spent-on-behalf expenses that the user is NOT recovering. Reads
      // TransactionSplit rows where isRecoverable=false — covers both
      // single-beneficiary legacy data (Slice 1 backfilled them) and
      // multi-contact splits. Recoverable shares show under Charges.
      prisma.transactionSplit.findMany({
        where: {
          workspaceId: ctx.workspaceId,
          contactId: id,
          isRecoverable: false,
          transaction: { type: "EXPENSE" },
        },
        orderBy: { transaction: { date: "desc" } },
        select: {
          id: true,
          amount: true,
          transaction: {
            select: {
              id: true,
              amount: true,
              date: true,
              description: true,
              memberChargeType: true,
              account: { select: { id: true, name: true } },
              card: { select: { id: true, name: true } },
              splits: { select: { id: true } },
            },
          },
        },
      }),
      // Hand loans with this contact, BOTH ways: ones they lent you (a payable
      // you still owe back) and ones you lent them (a receivable). Reported as
      // two separate totals on purpose — the contact screen leads with "they
      // owe you" and "you owe them" as two numbers, never one netted figure.
      prisma.loan.findMany({
        where: {
          workspaceId: ctx.workspaceId,
          OR: [{ lenderContactId: id }, { borrowerContactId: id }],
        },
        orderBy: [{ active: "desc" }, { startedAt: "desc" }],
        select: {
          id: true,
          kind: true,
          direction: true,
          repaymentMode: true,
          principal: true,
          outstanding: true,
          startedAt: true,
          nextDueDate: true,
          active: true,
          emiAmount: true,
          interestRate: true,
          interestCadence: true,
        },
      }),
      // Expenses this contact paid for the workspace owner (the new
      // paidByContactId flow). Each row is one of "they paid, I owe
      // back" (memberChargeType=RECOVERABLE → a USER_OWES charge
      // exists under `charges` above) or "gift / treat" (no obligation).
      prisma.transaction.findMany({
        where: {
          workspaceId: ctx.workspaceId,
          paidByContactId: id,
          type: "EXPENSE",
        },
        orderBy: { date: "desc" },
        take: 100,
        select: {
          id: true,
          amount: true,
          date: true,
          description: true,
          memberChargeType: true,
          category: {
            select: {
              id: true,
              name: true,
              parent: { select: { id: true, name: true } },
            },
          },
        },
      }),
    ]);

    const remainingOf = (c: (typeof charges)[number]) =>
      c.status !== "WRITTEN_OFF" ? Number(c.amount) - Number(c.settledAmount) : 0;
    const oweMeCharges = charges.filter((c) => c.direction === "OWED_TO_USER");
    const owedCharges = charges.filter((c) => c.direction === "USER_OWES");
    const owedToUser = oweMeCharges.reduce((s, c) => s + remainingOf(c), 0);
    const userOwes = owedCharges.reduce((s, c) => s + remainingOf(c), 0);
    // Preserve the legacy contract: `outstanding` = how much THIS contact
    // owes the workspace (non-negative). New `userOwes` is additive and
    // tracks the reverse direction. Consumers (reports, contacts list)
    // see no behavior change for the historical OWED_TO_USER flow.
    const totalOutstanding = owedToUser;
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
    type SpentSplit = (typeof expenses)[number];
    // `loansOwed` keeps its exact original meaning — open principal on money
    // this contact lent YOU — so existing consumers don't shift. `loansLent` is
    // the mirror. Never summed together.
    const loansOwed = loans.reduce(
      (s, l) =>
        s + (l.active && l.direction !== "LENT" ? Number(l.outstanding) : 0),
      0,
    );
    const loansLent = loans.reduce(
      (s, l) =>
        s + (l.active && l.direction === "LENT" ? Number(l.outstanding) : 0),
      0,
    );

    return NextResponse.json({
      member: { id: member.id, name: member.name },
      totals: {
        outstanding: round2(totalOutstanding),
        owedToUser: round2(owedToUser),
        userOwes: round2(userOwes),
        settled: round2(totalSettled),
        sentToContact: round2(sentToContact),
        receivedFromContact: round2(receivedFromContact),
        netTransferred,
        spentOnThem: round2(spentOnThem),
        loansOwed: round2(loansOwed),
        loansLent: round2(loansLent),
        // Advance credit sits alongside the owe/owed pair, never inside it
        // and never netted against it: `advanceHeld` is their money parked
        // with us, `advancePaid` is ours parked with them. Both are real
        // positions the contact screen shows in their own right.
        advanceHeld: round2(Number(member.advanceHeld)),
        advancePaid: round2(Number(member.advancePaid)),
      },
      charges: charges.map((c) => ({
        id: c.id,
        amount: Number(c.amount),
        settledAmount: Number(c.settledAmount),
        status: c.status,
        direction: c.direction,
        notes: c.notes,
        createdAt: c.createdAt.toISOString(),
        sourceTransferId: c.sourceTransferId,
        lastSettlementAt: c.lastSettlementAt?.toISOString() ?? null,
        origin: c.originSplit?.transaction
          ? {
              id: c.originSplit.transaction.id,
              description: c.originSplit.transaction.description,
              date: c.originSplit.transaction.date.toISOString(),
            }
          : null,
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
      expenses: expenses.map((e: SpentSplit) => ({
        id: e.transaction.id,
        amount: Number(e.amount),
        date: e.transaction.date.toISOString(),
        description: e.transaction.description,
        kind: e.transaction.memberChargeType,
        // Flag multi-contact splits so the UI can clarify "X of Y₹ total".
        isPartialOfTotal: e.transaction.splits.length > 1,
        transactionAmount: Number(e.transaction.amount),
        account: e.transaction.account ?? e.transaction.card,
      })),
      loans: loans.map((l) => ({
        id: l.id,
        kind: l.kind,
        direction: l.direction,
        repaymentMode: l.repaymentMode,
        principal: Number(l.principal),
        outstanding: Number(l.outstanding),
        startedAt: l.startedAt.toISOString(),
        nextDueDate: l.nextDueDate?.toISOString() ?? null,
        active: l.active,
        emiAmount: l.emiAmount == null ? null : Number(l.emiAmount),
        interestRate: l.interestRate == null ? null : Number(l.interestRate),
        interestCadence: l.interestCadence,
      })),
      paidForMe: paidForMe.map((t) => ({
        id: t.id,
        amount: Number(t.amount),
        date: t.date.toISOString(),
        description: t.description,
        memberChargeType: t.memberChargeType,
        category: t.category
          ? {
              id: t.category.id,
              name: t.category.name,
              parent: t.category.parent,
            }
          : null,
      })),
    });
  } catch (e) {
    return err(e);
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
