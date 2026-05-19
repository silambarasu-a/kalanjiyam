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
          select: {
            amount: true,
            settledAmount: true,
            status: true,
            direction: true,
          },
        },
      },
      orderBy: { name: "asc" },
    });

    const round2 = (n: number) => Math.round(n * 100) / 100;

    const rows = members.map((m) => {
      const totalCharged = m.memberCharges.reduce(
        (s, c) => s + Number(c.amount),
        0,
      );
      const totalSettled = m.memberCharges.reduce(
        (s, c) => s + Number(c.settledAmount),
        0,
      );
      // Split outstanding by direction so the report doesn't conflate
      // "they owe me" with "I owe them" into a single mystery number.
      let theyOweMe = 0;
      let iOweThem = 0;
      for (const c of m.memberCharges) {
        if (c.status === "WRITTEN_OFF") continue;
        const remaining = Number(c.amount) - Number(c.settledAmount);
        if (c.direction === "USER_OWES") iOweThem += remaining;
        else theyOweMe += remaining;
      }
      return {
        id: m.id,
        name: m.name,
        relationship: m.relationship,
        active: m.active,
        totalCharged: round2(totalCharged),
        totalSettled: round2(totalSettled),
        // Legacy alias — "outstanding" historically meant "what others
        // owe me". Keep that semantic so existing UI / consumers don't
        // silently flip sign.
        outstanding: round2(theyOweMe),
        theyOweMe: round2(theyOweMe),
        iOweThem: round2(iOweThem),
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
          theyOweMe: acc.theyOweMe + r.theyOweMe,
          iOweThem: acc.iOweThem + r.iOweThem,
        }),
        {
          totalCharged: 0,
          totalSettled: 0,
          outstanding: 0,
          theyOweMe: 0,
          iOweThem: 0,
        },
      ),
    });
  } catch (e) {
    return err(e);
  }
}
