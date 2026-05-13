import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { canAccessRecord, canModifyRecord } from "@/lib/permissions";
import {
  InvestmentKind,
  InsuranceStatus,
  PremiumFrequency,
  ReminderKind,
  ReminderStatus,
} from "@/generated/prisma/client";
import { computeReminderSchedule, policyReminderCount } from "@/lib/reminder-schedule";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[insurance/renew]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

const renewSchema = z
  .object({
    /**
     * "same"   — bump nextDueDate on the existing policy (premium and
     *            sum-assured may also be updated). Policy number stays.
     * "new"    — create a fresh Investment row linked back to this one
     *            via renewedFromInvestmentId. Old row gets RENEWED status
     *            so it stays queryable but drops out of active counts.
     */
    mode: z.enum(["same", "new"]),
    nextDueDate: z.string(),
    premiumAmount: z.number().positive().optional().nullable(),
    sumAssured: z.number().positive().optional().nullable(),
    /** Required when mode === "new". Optional bump to the new policy #. */
    newPolicyNumber: z.string().trim().max(80).optional(),
    /** Optional friendly name for the new policy row (defaults to old name). */
    newName: z.string().trim().min(1).max(120).optional(),
    /** Whether to copy covered members across to the new row. Default true. */
    copyMembers: z.boolean().optional().default(true),
    /** Optional new start date for the new row (defaults to today). */
    newStartedAt: z.string().optional(),
  })
  .refine(
    (d) =>
      d.mode !== "new" ||
      // For "new" mode we need either a new policy number OR a new name —
      // otherwise the new row is indistinguishable from the old in the UI.
      !!(d.newPolicyNumber?.trim() || d.newName?.trim()),
    {
      message:
        "Renewing as a new policy needs at least a new policy number or a new name",
      path: ["newPolicyNumber"],
    },
  );

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireWorkspace("insurance", "write");
    const session = await auth();
    const { id } = await context.params;
    const policy = await prisma.investment.findUnique({
      where: { id },
      include: {
        insuredMembers: true,
      },
    });
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
    if (!canModifyRecord(session, policy)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const parsed = renewSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const data = parsed.data;
    const nextDue = new Date(data.nextDueDate);

    if (data.mode === "same") {
      const updated = await prisma.investment.update({
        where: { id },
        data: {
          nextDueDate: nextDue,
          insuranceStatus: InsuranceStatus.ACTIVE,
          premiumAmount: data.premiumAmount ?? policy.premiumAmount,
          sumAssured: data.sumAssured ?? policy.sumAssured,
        },
      });
      return NextResponse.json({ id: updated.id, mode: "same" });
    }

    // mode === "new" — create a fresh row, link back, mark old RENEWED,
    // optionally copy members + regenerate reminders.
    const result = await prisma.$transaction(async (tx) => {
      const newName = data.newName?.trim() || policy.name;
      const newPolicyNumber = data.newPolicyNumber?.trim() || policy.policyNumber;
      const newStartedAt = data.newStartedAt
        ? new Date(data.newStartedAt)
        : new Date();

      const newRow = await tx.investment.create({
        data: {
          workspaceId: policy.workspaceId,
          ownerUserId: policy.ownerUserId,
          sharedWithUserIds: policy.sharedWithUserIds,
          holderName: policy.holderName,
          kind: InvestmentKind.INSURANCE,
          name: newName,
          institution: policy.institution,
          amount: data.premiumAmount ?? policy.premiumAmount ?? policy.amount,
          startedAt: newStartedAt,
          maturityAt: policy.maturityAt,
          notes: policy.notes,
          policyNumber: newPolicyNumber,
          policyType: policy.policyType,
          insuranceStatus: InsuranceStatus.ACTIVE,
          premiumAmount: data.premiumAmount ?? policy.premiumAmount,
          premiumFrequency: policy.premiumFrequency,
          sumAssured: data.sumAssured ?? policy.sumAssured,
          nextDueDate: nextDue,
          nominee: policy.nominee,
          vehicleId: policy.vehicleId,
          policyTermYears: policy.policyTermYears,
          premiumPayingTermYears: policy.premiumPayingTermYears,
          maturityValue: policy.maturityValue,
          bonusAccrued: policy.bonusAccrued,
          bonusLastRevisedAt: policy.bonusLastRevisedAt,
          ridersJson: (policy.ridersJson ?? undefined) as never,
          renewedFromInvestmentId: policy.id,
        },
      });

      if (data.copyMembers && policy.insuredMembers.length > 0) {
        await tx.insuredMember.createMany({
          data: policy.insuredMembers.map((m) => ({
            workspaceId: m.workspaceId,
            investmentId: newRow.id,
            contactId: m.contactId,
            premiumAmount: m.premiumAmount,
            premiumFrequency: m.premiumFrequency,
            sumAssured: m.sumAssured,
            coverageStart: newStartedAt,
            coverageEnd: m.coverageEnd,
            notes: m.notes,
            role: m.role,
            sharePercent: m.sharePercent,
          })),
        });
      }

      // Seed reminders for the new row when frequency + nextDue are set.
      // Old row's UPCOMING reminders are also marked SKIPPED so the user
      // doesn't see stale due-dates lingering after a renewal.
      if (newRow.premiumFrequency && newRow.nextDueDate) {
        const count = policyReminderCount({
          frequency: newRow.premiumFrequency as PremiumFrequency,
          firstDueDate: newRow.nextDueDate,
          premiumPayingTermYears: newRow.premiumPayingTermYears,
          policyTermYears: newRow.policyTermYears,
          maturityAt: newRow.maturityAt,
        });
        const dates = computeReminderSchedule({
          firstDueDate: newRow.nextDueDate,
          frequency: newRow.premiumFrequency as PremiumFrequency,
          count,
        });
        await tx.investmentReminder.createMany({
          data: dates.map((d) => ({
            workspaceId: newRow.workspaceId,
            investmentId: newRow.id,
            kind: ReminderKind.INSURANCE_PREMIUM,
            dueDate: d,
            amount: newRow.premiumAmount ?? null,
            status: ReminderStatus.UPCOMING,
          })),
        });
      }
      await tx.investmentReminder.updateMany({
        where: { investmentId: policy.id, status: ReminderStatus.UPCOMING },
        data: { status: ReminderStatus.SKIPPED, skippedReason: "Policy renewed" },
      });

      // Flip the predecessor to RENEWED + freeze its nextDueDate so the
      // chain is obvious in the UI and active counts stay clean.
      await tx.investment.update({
        where: { id: policy.id },
        data: {
          insuranceStatus: InsuranceStatus.RENEWED,
          active: false,
        },
      });

      return { id: newRow.id, mode: "new" as const };
    });

    return NextResponse.json(result);
  } catch (e) {
    return err(e);
  }
}
