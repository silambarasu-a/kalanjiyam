import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { canAccessRecord, canModifyRecord } from "@/lib/permissions";
import { loanUpdateSchema } from "@/lib/validators-domain";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

function featureForSource(source: string) {
  return source === "BANK" ? "bank_loans" : source === "CARD_EMI" ? "card_emi" : "hand_loans";
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const loan = await prisma.loan.findUnique({
      where: { id },
      include: {
        account: { select: { id: true, name: true } },
        card: { select: { id: true, name: true } },
        goldItems: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            name: true,
            quantity: true,
            weightGrams: true,
            purity: true,
            notes: true,
          },
        },
      },
    });
    if (!loan) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const ctx = await requireWorkspace(featureForSource(loan.source), "read");
    const session = await auth();
    if (loan.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!canAccessRecord(session, loan)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const payments = await prisma.transaction.findMany({
      where: { loanId: id },
      orderBy: { date: "desc" },
      take: 50,
    });
    return NextResponse.json({
      loan: {
        id: loan.id,
        kind: loan.kind,
        source: loan.source,
        lender: loan.lender,
        borrower: loan.borrower,
        principal: Number(loan.principal),
        outstanding: Number(loan.outstanding),
        interestRate: loan.interestRate == null ? null : Number(loan.interestRate),
        gstOnInterest: loan.gstOnInterest == null ? null : Number(loan.gstOnInterest),
        emiAmount: loan.emiAmount == null ? null : Number(loan.emiAmount),
        tenure: loan.tenure,
        frequency: loan.frequency,
        charges: loan.charges == null ? null : Number(loan.charges),
        account: loan.account,
        card: loan.card,
        startedAt: loan.startedAt.toISOString(),
        maturityAt: loan.maturityAt?.toISOString() ?? null,
        nextDueDate: loan.nextDueDate?.toISOString() ?? null,
        foreclosedAt: loan.foreclosedAt?.toISOString() ?? null,
        notes: loan.notes,
        active: loan.active,
        goldItems: loan.goldItems.map((g) => ({
          id: g.id,
          name: g.name,
          quantity: g.quantity,
          weightGrams: Number(g.weightGrams),
          purity: g.purity,
          notes: g.notes,
        })),
      },
      payments: payments.map((p) => ({
        id: p.id,
        amount: Number(p.amount),
        date: p.date.toISOString(),
        description: p.description,
      })),
    });
  } catch (e) {
    return err(e);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const loan = await prisma.loan.findUnique({ where: { id } });
    if (!loan) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const ctx = await requireWorkspace(featureForSource(loan.source), "write");
    const session = await auth();
    if (loan.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!canModifyRecord(session, loan)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = await request.json();
    const parsed = loanUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const updated = await prisma.loan.update({
      where: { id },
      data: {
        lender: parsed.data.lender ?? loan.lender,
        borrower: parsed.data.borrower ?? loan.borrower,
        interestRate: parsed.data.interestRate ?? loan.interestRate,
        gstOnInterest: parsed.data.gstOnInterest ?? loan.gstOnInterest,
        emiAmount: parsed.data.emiAmount ?? loan.emiAmount,
        tenure: parsed.data.tenure ?? loan.tenure,
        frequency: parsed.data.frequency ?? loan.frequency,
        charges: parsed.data.charges ?? loan.charges,
        maturityAt: parsed.data.maturityAt ? new Date(parsed.data.maturityAt) : loan.maturityAt,
        nextDueDate: parsed.data.nextDueDate ? new Date(parsed.data.nextDueDate) : loan.nextDueDate,
        notes: parsed.data.notes ?? loan.notes,
        active: parsed.data.active ?? loan.active,
      },
    });
    return NextResponse.json({ id: updated.id });
  } catch (e) {
    return err(e);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const loan = await prisma.loan.findUnique({ where: { id } });
    if (!loan) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const ctx = await requireWorkspace(featureForSource(loan.source), "write");
    const session = await auth();
    if (loan.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!canModifyRecord(session, loan)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const txCount = await prisma.transaction.count({ where: { loanId: id } });
    if (txCount > 0) {
      return NextResponse.json(
        { error: "Loan has payment history — archive (active=false) instead." },
        { status: 400 }
      );
    }
    await prisma.loan.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}
