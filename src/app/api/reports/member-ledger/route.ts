import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function GET() {
  try {
    const ctx = await requireWorkspace("reports", "read");

    const members = await prisma.contact.findMany({
      where: { workspaceId: ctx.workspaceId },
      include: {
        memberCharges: {
          select: { amount: true, settledAmount: true, status: true },
        },
      },
      orderBy: { name: "asc" },
    });

    const rows = members.map((m) => {
      const totalCharged = m.memberCharges.reduce((s, c) => s + Number(c.amount), 0);
      const totalSettled = m.memberCharges.reduce((s, c) => s + Number(c.settledAmount), 0);
      const outstanding = m.memberCharges.reduce(
        (s, c) =>
          s +
          (c.status === "WRITTEN_OFF"
            ? 0
            : Number(c.amount) - Number(c.settledAmount)),
        0
      );
      return {
        id: m.id,
        name: m.name,
        relationship: m.relationship,
        active: m.active,
        totalCharged: Math.round(totalCharged * 100) / 100,
        totalSettled: Math.round(totalSettled * 100) / 100,
        outstanding: Math.round(outstanding * 100) / 100,
        chargeCount: m.memberCharges.length,
      };
    });

    return NextResponse.json({
      members: rows,
      totals: rows.reduce(
        (acc, r) => ({
          totalCharged: acc.totalCharged + r.totalCharged,
          totalSettled: acc.totalSettled + r.totalSettled,
          outstanding: acc.outstanding + r.outstanding,
        }),
        { totalCharged: 0, totalSettled: 0, outstanding: 0 }
      ),
    });
  } catch (e) {
    return err(e);
  }
}
