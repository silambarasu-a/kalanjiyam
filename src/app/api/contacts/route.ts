import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { familyCreateSchema } from "@/lib/validators-domain";

function error(err: unknown) {
  if (err instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error("[contacts]", err);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function GET() {
  try {
    const ctx = await requireWorkspace("contacts", "read");
    const [members, charges] = await Promise.all([
      prisma.contact.findMany({
        where: { workspaceId: ctx.workspaceId },
        orderBy: [{ active: "desc" }, { name: "asc" }],
        include: { user: { select: { id: true, email: true, name: true } } },
      }),
      // One round-trip for all charges in the workspace, then group in
      // memory. Mirrors the per-member ledger API: outstanding excludes
      // WRITTEN_OFF rows; settled counts paid amount on every status.
      prisma.memberCharge.findMany({
        where: { workspaceId: ctx.workspaceId },
        select: {
          beneficiaryContactId: true,
          amount: true,
          settledAmount: true,
          status: true,
        },
      }),
    ]);

    const totalsByMember = new Map<string, { outstanding: number; settled: number }>();
    for (const c of charges) {
      if (!c.beneficiaryContactId) continue;
      const cur = totalsByMember.get(c.beneficiaryContactId) ?? { outstanding: 0, settled: 0 };
      if (c.status !== "WRITTEN_OFF") {
        cur.outstanding += Number(c.amount) - Number(c.settledAmount);
      }
      cur.settled += Number(c.settledAmount);
      totalsByMember.set(c.beneficiaryContactId, cur);
    }

    return NextResponse.json({
      members: members.map((m) => {
        const t = totalsByMember.get(m.id) ?? { outstanding: 0, settled: 0 };
        return {
          id: m.id,
          name: m.name,
          relationship: m.relationship,
          dob: m.dob?.toISOString() ?? null,
          notes: m.notes,
          active: m.active,
          linkedUser: m.user ? { id: m.user.id, email: m.user.email, name: m.user.name } : null,
          totals: t,
        };
      }),
    });
  } catch (err) {
    return error(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireWorkspace("contacts", "write");
    const body = await request.json();
    const parsed = familyCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const member = await prisma.contact.create({
      data: {
        workspaceId: ctx.workspaceId,
        name: parsed.data.name,
        relationship: parsed.data.relationship,
        dob: parsed.data.dob ? new Date(parsed.data.dob) : null,
        notes: parsed.data.notes,
        userId: parsed.data.userId ?? null,
      },
    });
    return NextResponse.json({ id: member.id });
  } catch (err) {
    return error(err);
  }
}
