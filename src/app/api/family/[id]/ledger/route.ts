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

    const member = await prisma.familyMember.findUnique({ where: { id } });
    if (!member || member.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const charges = await prisma.memberCharge.findMany({
      where: { workspaceId: ctx.workspaceId, beneficiaryMemberId: id },
      orderBy: { createdAt: "desc" },
      include: {
        originTransaction: { select: { id: true, description: true, date: true } },
        settlements: { orderBy: { paidAt: "desc" } },
      },
    });

    const totalOutstanding = charges.reduce(
      (sum, c) => sum + (c.status !== "WRITTEN_OFF" ? Number(c.amount) - Number(c.settledAmount) : 0),
      0
    );
    const totalSettled = charges.reduce((sum, c) => sum + Number(c.settledAmount), 0);

    return NextResponse.json({
      member: { id: member.id, name: member.name },
      totals: { outstanding: totalOutstanding, settled: totalSettled },
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
    });
  } catch (e) {
    return err(e);
  }
}
