import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { handLoanMemberUpdateSchema } from "@/lib/validators-domain";

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
    const ctx = await requireWorkspace("hand_loans", "read");
    const { id } = await context.params;
    const member = await prisma.handLoanMember.findUnique({
      where: { id },
      include: {
        familyMember: { select: { id: true, name: true } },
        entries: {
          orderBy: { date: "desc" },
          include: { transaction: { select: { id: true, accountId: true } } },
        },
      },
    });
    if (!member || member.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const given = member.entries
      .filter((e) => e.direction === "GIVEN")
      .reduce((s, e) => s + Number(e.amount), 0);
    const received = member.entries
      .filter((e) => e.direction === "RECEIVED")
      .reduce((s, e) => s + Number(e.amount), 0);
    return NextResponse.json({
      member: {
        id: member.id,
        name: member.name,
        email: member.email,
        phone: member.phone,
        familyMember: member.familyMember,
        notes: member.notes,
        active: member.active,
      },
      totals: {
        given: Math.round(given * 100) / 100,
        received: Math.round(received * 100) / 100,
        balance: Math.round((given - received) * 100) / 100,
      },
      entries: member.entries.map((e) => ({
        id: e.id,
        direction: e.direction,
        kind: e.kind,
        amount: Number(e.amount),
        date: e.date.toISOString(),
        notes: e.notes,
        transactionId: e.transactionId,
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
    const ctx = await requireWorkspace("hand_loans", "write");
    const { id } = await context.params;
    const existing = await prisma.handLoanMember.findUnique({ where: { id } });
    if (!existing || existing.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const body = await request.json();
    const parsed = handLoanMemberUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const member = await prisma.handLoanMember.update({
      where: { id },
      data: {
        name: parsed.data.name ?? existing.name,
        email: parsed.data.email ?? existing.email,
        phone: parsed.data.phone ?? existing.phone,
        familyMemberId: parsed.data.familyMemberId ?? existing.familyMemberId,
        notes: parsed.data.notes ?? existing.notes,
        active: parsed.data.active ?? existing.active,
      },
    });
    return NextResponse.json({ id: member.id });
  } catch (e) {
    return err(e);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireWorkspace("hand_loans", "write");
    const { id } = await context.params;
    const existing = await prisma.handLoanMember.findUnique({ where: { id } });
    if (!existing || existing.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const entryCount = await prisma.handLoanEntry.count({ where: { memberId: id } });
    if (entryCount > 0) {
      return NextResponse.json(
        { error: "Has entries — archive (active=false) instead of deleting." },
        { status: 400 }
      );
    }
    await prisma.handLoanMember.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}
