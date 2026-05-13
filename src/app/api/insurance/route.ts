import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { visibilityFilter } from "@/lib/permissions";
import { InvestmentKind, InsurancePolicyType } from "@/generated/prisma/client";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[insurance]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const ctx = await requireWorkspace("insurance", "read");
    const session = await auth();
    const url = new URL(request.url);
    const policyType = url.searchParams.get("policyType") as InsurancePolicyType | null;
    const policies = await prisma.investment.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        kind: InvestmentKind.INSURANCE,
        ...(policyType ? { policyType } : {}),
        ...visibilityFilter(session, ctx.ownOnly),
      },
      orderBy: [{ active: "desc" }, { nextDueDate: "asc" }],
      include: {
        ownerUser: { select: { id: true, name: true } },
        insuredMembers: {
          where: { active: true },
          include: { contact: { select: { id: true, name: true } } },
        },
        _count: { select: { claims: true } },
      },
    });
    return NextResponse.json({
      policies: policies.map((p) => ({
        id: p.id,
        name: p.name,
        institution: p.institution,
        policyNumber: p.policyNumber,
        policyType: p.policyType,
        insuranceStatus: p.insuranceStatus,
        premiumAmount: p.premiumAmount == null ? null : Number(p.premiumAmount),
        premiumFrequency: p.premiumFrequency,
        sumAssured: p.sumAssured == null ? null : Number(p.sumAssured),
        nextDueDate: p.nextDueDate?.toISOString() ?? null,
        nominee: p.nominee,
        startedAt: p.startedAt.toISOString(),
        maturityAt: p.maturityAt?.toISOString() ?? null,
        active: p.active,
        ownerUser: p.ownerUser,
        memberCount: p.insuredMembers.length,
        members: p.insuredMembers.map((m) => ({
          id: m.id,
          contactId: m.contactId,
          contactName: m.contact.name,
          premiumAmount: m.premiumAmount == null ? null : Number(m.premiumAmount),
          premiumFrequency: m.premiumFrequency,
        })),
        claimCount: p._count.claims,
      })),
    });
  } catch (e) {
    return err(e);
  }
}
