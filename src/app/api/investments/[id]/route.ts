import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { canAccessRecord, canModifyRecord } from "@/lib/permissions";
import { investmentUpdateSchema } from "@/lib/validators-domain";

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
    const ctx = await requireWorkspace("investments", "read");
    const session = await auth();
    const { id } = await context.params;
    const inv = await prisma.investment.findUnique({ where: { id } });
    if (!inv || inv.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!canAccessRecord(session, inv)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const [transactions, reminders] = await Promise.all([
      prisma.transaction.findMany({
        where: { investmentId: id },
        orderBy: { date: "desc" },
        take: 50,
      }),
      prisma.investmentReminder.findMany({
        where: { investmentId: id },
        orderBy: { dueDate: "asc" },
        take: 24,
      }),
    ]);
    return NextResponse.json({
      investment: {
        id: inv.id,
        kind: inv.kind,
        name: inv.name,
        institution: inv.institution,
        amount: Number(inv.amount),
        currentValue: inv.currentValue == null ? null : Number(inv.currentValue),
        interestRate: inv.interestRate == null ? null : Number(inv.interestRate),
        startedAt: inv.startedAt.toISOString(),
        maturityAt: inv.maturityAt?.toISOString() ?? null,
        active: inv.active,
        notes: inv.notes,
        symbol: inv.symbol,
        quantity: inv.quantity == null ? null : Number(inv.quantity),
        purchasePrice: inv.purchasePrice == null ? null : Number(inv.purchasePrice),
        policyNumber: inv.policyNumber,
        policyType: inv.policyType,
        premiumAmount: inv.premiumAmount == null ? null : Number(inv.premiumAmount),
        premiumFrequency: inv.premiumFrequency,
        sumAssured: inv.sumAssured == null ? null : Number(inv.sumAssured),
        nextDueDate: inv.nextDueDate?.toISOString() ?? null,
      },
      transactions: transactions.map((t) => ({
        id: t.id,
        amount: Number(t.amount),
        description: t.description,
        date: t.date.toISOString(),
        type: t.type,
        action: t.investmentAction,
        quantity: t.investmentQty == null ? null : Number(t.investmentQty),
        price: t.investmentPrice == null ? null : Number(t.investmentPrice),
      })),
      reminders: reminders.map((r) => ({
        id: r.id,
        kind: r.kind,
        dueDate: r.dueDate.toISOString(),
        amount: r.amount == null ? null : Number(r.amount),
        status: r.status,
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
    const ctx = await requireWorkspace("investments", "write");
    const session = await auth();
    const { id } = await context.params;
    const inv = await prisma.investment.findUnique({ where: { id } });
    if (!inv || inv.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!canModifyRecord(session, inv)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = await request.json();
    const parsed = investmentUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const updated = await prisma.investment.update({
      where: { id },
      data: {
        name: parsed.data.name ?? inv.name,
        institution: parsed.data.institution ?? inv.institution,
        currentValue: parsed.data.currentValue ?? inv.currentValue,
        interestRate: parsed.data.interestRate ?? inv.interestRate,
        maturityAt: parsed.data.maturityAt ? new Date(parsed.data.maturityAt) : inv.maturityAt,
        notes: parsed.data.notes ?? inv.notes,
        active: parsed.data.active ?? inv.active,
        premiumAmount: parsed.data.premiumAmount ?? inv.premiumAmount,
        nextDueDate: parsed.data.nextDueDate ? new Date(parsed.data.nextDueDate) : inv.nextDueDate,
        nominee: parsed.data.nominee ?? inv.nominee,
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
    const ctx = await requireWorkspace("investments", "write");
    const session = await auth();
    const { id } = await context.params;
    const inv = await prisma.investment.findUnique({ where: { id } });
    if (!inv || inv.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!canModifyRecord(session, inv)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const txCount = await prisma.transaction.count({ where: { investmentId: id } });
    if (txCount > 0) {
      return NextResponse.json(
        { error: "Has transactions — archive (active=false) instead." },
        { status: 400 }
      );
    }
    await prisma.investment.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}
