import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { handLoanMemberCreateSchema } from "@/lib/validators-domain";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[hand-loan-members]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function GET() {
  try {
    const ctx = await requireWorkspace("hand_loans", "read");
    await auth();
    const members = await prisma.handLoanMember.findMany({
      where: { workspaceId: ctx.workspaceId },
      orderBy: [{ active: "desc" }, { name: "asc" }],
      include: {
        familyMember: { select: { id: true, name: true } },
        entries: { select: { direction: true, amount: true } },
      },
    });

    return NextResponse.json({
      members: members.map((m) => {
        const given = m.entries
          .filter((e) => e.direction === "GIVEN")
          .reduce((s, e) => s + Number(e.amount), 0);
        const received = m.entries
          .filter((e) => e.direction === "RECEIVED")
          .reduce((s, e) => s + Number(e.amount), 0);
        return {
          id: m.id,
          name: m.name,
          email: m.email,
          phone: m.phone,
          active: m.active,
          familyMember: m.familyMember,
          totalGiven: Math.round(given * 100) / 100,
          totalReceived: Math.round(received * 100) / 100,
          balance: Math.round((given - received) * 100) / 100,
          entryCount: m.entries.length,
        };
      }),
    });
  } catch (e) {
    return err(e);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireWorkspace("hand_loans", "write");
    const body = await request.json();
    const parsed = handLoanMemberCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const member = await prisma.handLoanMember.create({
      data: {
        workspaceId: ctx.workspaceId,
        name: parsed.data.name,
        email: parsed.data.email || null,
        phone: parsed.data.phone,
        familyMemberId: parsed.data.familyMemberId ?? null,
        notes: parsed.data.notes,
      },
    });
    return NextResponse.json({ id: member.id });
  } catch (e) {
    return err(e);
  }
}
