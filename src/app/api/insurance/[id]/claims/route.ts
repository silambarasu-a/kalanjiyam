import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { canAccessRecord, canModifyRecord } from "@/lib/permissions";
import { insuranceClaimCreateSchema } from "@/lib/validators-domain";
import { InvestmentKind, ClaimStatus } from "@/generated/prisma/client";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[insurance/claims]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireWorkspace("insurance", "read");
    const session = await auth();
    const { id } = await context.params;
    const policy = await prisma.investment.findUnique({ where: { id } });
    if (
      !policy ||
      policy.workspaceId !== ctx.workspaceId ||
      policy.kind !== InvestmentKind.INSURANCE
    ) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!canAccessRecord(session, policy)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const claims = await prisma.insuranceClaim.findMany({
      where: { investmentId: id },
      orderBy: [{ incidentDate: "desc" }],
      include: {
        insuredMember: {
          include: { contact: { select: { id: true, name: true } } },
        },
        _count: { select: { transactions: true } },
      },
    });
    return NextResponse.json({
      claims: claims.map((c) => ({
        id: c.id,
        claimNumber: c.claimNumber,
        incidentDate: c.incidentDate.toISOString(),
        filedAt: c.filedAt?.toISOString() ?? null,
        status: c.status,
        claimedAmount: c.claimedAmount == null ? null : Number(c.claimedAmount),
        approvedAmount: c.approvedAmount == null ? null : Number(c.approvedAmount),
        receivedAmount: c.receivedAmount == null ? null : Number(c.receivedAmount),
        notes: c.notes,
        insuredMember: c.insuredMember
          ? {
              id: c.insuredMember.id,
              contactId: c.insuredMember.contactId,
              contactName: c.insuredMember.contact.name,
            }
          : null,
        transactionCount: c._count.transactions,
      })),
    });
  } catch (e) {
    return err(e);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireWorkspace("insurance", "write");
    const session = await auth();
    const { id } = await context.params;
    const policy = await prisma.investment.findUnique({ where: { id } });
    if (
      !policy ||
      policy.workspaceId !== ctx.workspaceId ||
      policy.kind !== InvestmentKind.INSURANCE
    ) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!canModifyRecord(session, policy)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = await request.json();
    const parsed = insuranceClaimCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const data = parsed.data;

    // If a member is specified, it must belong to this policy. This guards
    // against cross-policy member-id injection.
    if (data.insuredMemberId) {
      const member = await prisma.insuredMember.findUnique({
        where: { id: data.insuredMemberId },
      });
      if (!member || member.investmentId !== id) {
        return NextResponse.json(
          { error: "Insured member not found on this policy" },
          { status: 400 },
        );
      }
    }

    // If a hospitalization is supplied it must belong to this workspace.
    if (data.hospitalizationId) {
      const h = await prisma.hospitalization.findUnique({
        where: { id: data.hospitalizationId },
        select: { workspaceId: true },
      });
      if (!h || h.workspaceId !== ctx.workspaceId) {
        return NextResponse.json(
          { error: "Hospitalization not found" },
          { status: 400 },
        );
      }
    }

    const claim = await prisma.insuranceClaim.create({
      data: {
        workspaceId: ctx.workspaceId,
        investmentId: id,
        insuredMemberId: data.insuredMemberId ?? null,
        hospitalizationId: data.hospitalizationId ?? null,
        vehicleId: data.vehicleId ?? null,
        claimNumber: data.claimNumber,
        incidentDate: new Date(data.incidentDate),
        filedAt: data.filedAt ? new Date(data.filedAt) : null,
        status: (data.status as ClaimStatus | undefined) ?? ClaimStatus.FILED,
        claimedAmount: data.claimedAmount ?? null,
        approvedAmount: data.approvedAmount ?? null,
        receivedAmount: data.receivedAmount ?? null,
        notes: data.notes,
      },
    });
    return NextResponse.json({ id: claim.id });
  } catch (e) {
    return err(e);
  }
}
