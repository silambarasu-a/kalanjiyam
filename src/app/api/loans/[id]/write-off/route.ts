import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { canModifyRecord } from "@/lib/permissions";
import { loanWriteOffSchema } from "@/lib/validators-domain";
import { LoanLedgerKind } from "@/generated/prisma/client";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[loan/write-off]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

/**
 * Give up on the unrecovered principal of a loan you lent out.
 *
 * Records a WRITE_OFF ledger entry for the remaining principal and closes the
 * loan, which drops the receivable out of net worth. Deliberately posts **no
 * Transaction**: no money moved, and inventing a bad-debt EXPENSE would
 * distort the expense report and the account balance for a month in which
 * nothing actually left the account.
 *
 * Lent-only. A borrowed loan you stop paying isn't yours to forgive — that's
 * the lender's call, and the liability stays until they say otherwise.
 *
 * Without this route the only exits from an uncollectable loan are editing
 * `outstanding` to 0 (which the closed-loan lock eventually blocks) or deleting
 * the loan (blocked once it has payment history).
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const loan = await prisma.loan.findUnique({ where: { id } });
    if (!loan) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const ctx = await requireWorkspace("hand_loans", "write");
    const session = await auth();
    if (loan.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!canModifyRecord(session, loan)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (loan.direction !== "LENT") {
      return NextResponse.json(
        { error: "Only money you lent out can be written off." },
        { status: 400 },
      );
    }
    if (!loan.active) {
      return NextResponse.json(
        { error: "This loan is already closed." },
        { status: 423 },
      );
    }

    const parsed = loanWriteOffSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const data = parsed.data;

    const outstanding = Number(loan.outstanding);
    if (outstanding <= 0) {
      return NextResponse.json(
        { error: "Nothing left to write off — close the loan instead." },
        { status: 400 },
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.loanLedgerEntry.create({
        data: {
          workspaceId: ctx.workspaceId,
          loanId: id,
          kind: LoanLedgerKind.WRITE_OFF,
          // The principal is what was cancelled; `amount` is the cash that
          // moved, which is nothing.
          principalAmount: outstanding,
          amount: 0,
          paidAt: new Date(data.writtenOffAt),
          notes: data.notes ?? null,
          createdByUserId: ctx.userId,
        },
      });
      await tx.loan.update({
        where: { id },
        data: {
          outstanding: 0,
          active: false,
          foreclosedAt: new Date(data.writtenOffAt),
          nextDueDate: null,
        },
      });
    });

    return NextResponse.json({ ok: true, writtenOff: outstanding });
  } catch (e) {
    return err(e);
  }
}
