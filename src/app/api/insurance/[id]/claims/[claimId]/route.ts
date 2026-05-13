import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { canAccessRecord, canModifyRecord } from "@/lib/permissions";
import { insuranceClaimUpdateSchema } from "@/lib/validators-domain";
import { ClaimStatus } from "@/generated/prisma/client";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[insurance/claims/:claimId]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

async function loadGuarded(
  policyId: string,
  claimId: string,
  ctxWorkspaceId: string,
  action: "read" | "write",
  session: Parameters<typeof canAccessRecord>[0],
) {
  const claim = await prisma.insuranceClaim.findUnique({
    where: { id: claimId },
    include: {
      investment: true,
      transactions: {
        select: { id: true, amount: true, date: true, description: true },
        orderBy: { date: "desc" },
      },
    },
  });
  if (
    !claim ||
    claim.workspaceId !== ctxWorkspaceId ||
    claim.investmentId !== policyId
  ) {
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  const check = action === "write" ? canModifyRecord : canAccessRecord;
  if (!check(session, claim.investment)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { claim };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; claimId: string }> },
) {
  try {
    const ctx = await requireWorkspace("insurance", "read");
    const session = await auth();
    const { id, claimId } = await context.params;
    const guard = await loadGuarded(id, claimId, ctx.workspaceId, "read", session);
    if ("error" in guard) return guard.error;
    const c = guard.claim;
    return NextResponse.json({
      claim: {
        id: c.id,
        claimNumber: c.claimNumber,
        incidentDate: c.incidentDate.toISOString(),
        filedAt: c.filedAt?.toISOString() ?? null,
        status: c.status,
        claimedAmount: c.claimedAmount == null ? null : Number(c.claimedAmount),
        approvedAmount: c.approvedAmount == null ? null : Number(c.approvedAmount),
        receivedAmount: c.receivedAmount == null ? null : Number(c.receivedAmount),
        notes: c.notes,
        insuredMemberId: c.insuredMemberId,
        transactions: c.transactions.map((t) => ({
          id: t.id,
          amount: Number(t.amount),
          date: t.date.toISOString(),
          description: t.description,
        })),
      },
    });
  } catch (e) {
    return err(e);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; claimId: string }> },
) {
  try {
    const ctx = await requireWorkspace("insurance", "write");
    const session = await auth();
    const { id, claimId } = await context.params;
    const guard = await loadGuarded(id, claimId, ctx.workspaceId, "write", session);
    if ("error" in guard) return guard.error;

    const body = await request.json();
    const parsed = insuranceClaimUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const data = parsed.data;

    if (data.insuredMemberId !== undefined && data.insuredMemberId !== null) {
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

    const updated = await prisma.insuranceClaim.update({
      where: { id: claimId },
      data: {
        claimNumber: data.claimNumber ?? guard.claim.claimNumber,
        incidentDate: data.incidentDate
          ? new Date(data.incidentDate)
          : guard.claim.incidentDate,
        filedAt:
          data.filedAt === undefined
            ? guard.claim.filedAt
            : data.filedAt
              ? new Date(data.filedAt)
              : null,
        status: (data.status as ClaimStatus | undefined) ?? guard.claim.status,
        claimedAmount: data.claimedAmount ?? guard.claim.claimedAmount,
        approvedAmount: data.approvedAmount ?? guard.claim.approvedAmount,
        receivedAmount: data.receivedAmount ?? guard.claim.receivedAmount,
        notes: data.notes ?? guard.claim.notes,
        insuredMemberId:
          data.insuredMemberId === undefined
            ? guard.claim.insuredMemberId
            : data.insuredMemberId,
      },
    });
    return NextResponse.json({ id: updated.id });
  } catch (e) {
    return err(e);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; claimId: string }> },
) {
  try {
    const ctx = await requireWorkspace("insurance", "write");
    const session = await auth();
    const { id, claimId } = await context.params;
    const guard = await loadGuarded(id, claimId, ctx.workspaceId, "write", session);
    if ("error" in guard) return guard.error;
    await prisma.insuranceClaim.delete({ where: { id: claimId } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}
