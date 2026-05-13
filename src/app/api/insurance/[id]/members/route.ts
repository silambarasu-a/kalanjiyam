import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import {
  requireWorkspace,
  WorkspaceAccessError,
  assertWorkspaceContact,
} from "@/lib/workspace";
import { canAccessRecord, canModifyRecord } from "@/lib/permissions";
import { insuredMemberCreateSchema } from "@/lib/validators-domain";
import { computeReminderSchedule } from "@/lib/reminder-schedule";
import {
  InvestmentKind,
  PremiumFrequency,
  ReminderKind,
  ReminderStatus,
  InsuredMemberRole,
} from "@/generated/prisma/client";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[insurance/members]", e);
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
    const members = await prisma.insuredMember.findMany({
      where: { investmentId: id },
      orderBy: [{ active: "desc" }, { createdAt: "asc" }],
      include: {
        contact: { select: { id: true, name: true, relationship: true } },
      },
    });
    return NextResponse.json({
      members: members.map((m) => ({
        id: m.id,
        contactId: m.contactId,
        contact: m.contact,
        premiumAmount: m.premiumAmount == null ? null : Number(m.premiumAmount),
        premiumFrequency: m.premiumFrequency,
        sumAssured: m.sumAssured == null ? null : Number(m.sumAssured),
        coverageStart: m.coverageStart?.toISOString() ?? null,
        coverageEnd: m.coverageEnd?.toISOString() ?? null,
        active: m.active,
        notes: m.notes,
        role: m.role,
        sharePercent: m.sharePercent == null ? null : Number(m.sharePercent),
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
    const parsed = insuredMemberCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const data = parsed.data;
    await assertWorkspaceContact(ctx.workspaceId, data.contactId);

    // Beneficiary share validation: existing-beneficiary shares + this new
    // member's share must not exceed 100%. Only enforced for BENEFICIARY
    // role; INSURED role rows can coexist freely (one policy can have N
    // insured members, plus N beneficiaries that allocate the death benefit).
    if (data.role === "BENEFICIARY") {
      const existingShares = await prisma.insuredMember.aggregate({
        where: { investmentId: id, role: InsuredMemberRole.BENEFICIARY, active: true },
        _sum: { sharePercent: true },
      });
      const existing = Number(existingShares._sum.sharePercent ?? 0);
      if (existing + (data.sharePercent ?? 0) > 100.01) {
        return NextResponse.json(
          {
            error: `Beneficiary shares would exceed 100% (currently ${existing}% allocated)`,
          },
          { status: 400 },
        );
      }
    }

    const member = await prisma.$transaction(async (tx) => {
      const m = await tx.insuredMember.create({
        data: {
          workspaceId: ctx.workspaceId,
          investmentId: id,
          contactId: data.contactId,
          premiumAmount: data.premiumAmount ?? null,
          premiumFrequency: data.premiumFrequency ?? null,
          sumAssured: data.sumAssured ?? null,
          coverageStart: data.coverageStart ? new Date(data.coverageStart) : null,
          coverageEnd: data.coverageEnd ? new Date(data.coverageEnd) : null,
          notes: data.notes,
          role: (data.role as InsuredMemberRole | undefined) ?? InsuredMemberRole.INSURED,
          sharePercent: data.sharePercent ?? null,
        },
      });

      // When the member carries its own premium + frequency, generate a
      // per-member reminder series. Without member-level overrides, the
      // existing policy-level reminders cover this member implicitly — no
      // duplicate reminders.
      const memberFreq = data.premiumFrequency;
      const memberAmount = data.premiumAmount;
      if (memberFreq && memberAmount && policy.nextDueDate) {
        const dates = computeReminderSchedule({
          firstDueDate: new Date(policy.nextDueDate),
          frequency: memberFreq as PremiumFrequency,
          count: 12,
        });
        await tx.investmentReminder.createMany({
          data: dates.map((d) => ({
            workspaceId: ctx.workspaceId,
            investmentId: id,
            insuredMemberId: m.id,
            kind: ReminderKind.INSURANCE_PREMIUM,
            dueDate: d,
            amount: memberAmount,
            status: ReminderStatus.UPCOMING,
          })),
        });
      }

      return m;
    });

    return NextResponse.json({ id: member.id });
  } catch (e) {
    return err(e);
  }
}
