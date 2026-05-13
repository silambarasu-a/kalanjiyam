import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { canAccessRecord, canModifyRecord } from "@/lib/permissions";
import { insuredMemberUpdateSchema } from "@/lib/validators-domain";
import { InsuredMemberRole } from "@/generated/prisma/client";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[insurance/members/:id]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

async function loadGuarded(
  policyId: string,
  memberId: string,
  ctxWorkspaceId: string,
  action: "read" | "write",
  session: Parameters<typeof canAccessRecord>[0],
) {
  const member = await prisma.insuredMember.findUnique({
    where: { id: memberId },
    include: { investment: true },
  });
  if (
    !member ||
    member.workspaceId !== ctxWorkspaceId ||
    member.investmentId !== policyId
  ) {
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  const check = action === "write" ? canModifyRecord : canAccessRecord;
  if (!check(session, member.investment)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { member };
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; memberId: string }> },
) {
  try {
    const ctx = await requireWorkspace("insurance", "write");
    const session = await auth();
    const { id, memberId } = await context.params;
    const guard = await loadGuarded(id, memberId, ctx.workspaceId, "write", session);
    if ("error" in guard) return guard.error;

    const body = await request.json();
    const parsed = insuredMemberUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const data = parsed.data;

    // Beneficiary share guard on PATCH — recompute the policy's total
    // beneficiary share excluding this member's own row, then check the
    // proposed update against 100%.
    const newRole = (data.role as InsuredMemberRole | undefined) ?? guard.member.role;
    const newShare =
      data.sharePercent === undefined
        ? Number(guard.member.sharePercent ?? 0)
        : Number(data.sharePercent ?? 0);
    if (newRole === InsuredMemberRole.BENEFICIARY) {
      const existing = await prisma.insuredMember.aggregate({
        where: {
          investmentId: id,
          role: InsuredMemberRole.BENEFICIARY,
          active: true,
          id: { not: memberId },
        },
        _sum: { sharePercent: true },
      });
      const others = Number(existing._sum.sharePercent ?? 0);
      if (others + newShare > 100.01) {
        return NextResponse.json(
          {
            error: `Beneficiary shares would exceed 100% (other beneficiaries hold ${others}%)`,
          },
          { status: 400 },
        );
      }
    }

    const updated = await prisma.insuredMember.update({
      where: { id: memberId },
      data: {
        premiumAmount: data.premiumAmount ?? guard.member.premiumAmount,
        premiumFrequency: data.premiumFrequency ?? guard.member.premiumFrequency,
        sumAssured: data.sumAssured ?? guard.member.sumAssured,
        coverageStart: data.coverageStart
          ? new Date(data.coverageStart)
          : guard.member.coverageStart,
        coverageEnd: data.coverageEnd
          ? new Date(data.coverageEnd)
          : guard.member.coverageEnd,
        notes: data.notes ?? guard.member.notes,
        active: data.active ?? guard.member.active,
        role: newRole,
        // sharePercent is only meaningful for BENEFICIARY rows — when the
        // role flips away to INSURED, scrub any stale percent that was
        // left over from a prior beneficiary state.
        sharePercent:
          newRole !== InsuredMemberRole.BENEFICIARY
            ? null
            : data.sharePercent === undefined
              ? guard.member.sharePercent
              : (data.sharePercent ?? null),
      },
    });
    return NextResponse.json({ id: updated.id });
  } catch (e) {
    return err(e);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; memberId: string }> },
) {
  try {
    const ctx = await requireWorkspace("insurance", "write");
    const session = await auth();
    const { id, memberId } = await context.params;
    const guard = await loadGuarded(id, memberId, ctx.workspaceId, "write", session);
    if ("error" in guard) return guard.error;
    await prisma.insuredMember.delete({ where: { id: memberId } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}
