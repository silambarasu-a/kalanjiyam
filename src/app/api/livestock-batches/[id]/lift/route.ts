import { NextResponse } from "next/server";
import {
  LivestockEventType,
  TransactionKind,
  TransactionType,
  WeighingPhase,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { canAccessRecord } from "@/lib/permissions";
import { liftEventSchema } from "@/lib/validators-domain";
import { computeBatchAnalytics } from "@/lib/livestock-analytics";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[lift]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

/**
 * Record the integrator pickup for a BROILER_CONTRACT batch.
 *
 * Atomically:
 *   1. Creates an EXIT WeighingLog from the actual lifted weight.
 *   2. Creates a SALE LivestockEvent so head-count moves correctly.
 *   3. Computes the contract payout via `computeBatchAnalytics` and
 *      writes a single INCOME Transaction (kind=CONTRACT_PAYOUT) with
 *      the full breakdown stamped into the description.
 *   4. Decrements `currentCount` and (when `closeBatch=true`) flips the
 *      batch to `active=false` + sets `endDate`.
 *
 * Replaces the manual "record a SALE, then fight the math" flow.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireWorkspace("livestock", "write");
    const session = await auth();
    const { id } = await context.params;
    const body = await request.json();
    const parsed = liftEventSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const d = parsed.data;

    const batch = await prisma.livestockBatch.findUnique({
      where: { id },
      include: {
        livestock: { select: { workspaceId: true } },
        contract: true,
      },
    });
    if (!batch || batch.livestock.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (batch.productionType !== "BROILER_CONTRACT") {
      return NextResponse.json(
        {
          error:
            "Lift events are for broiler-contract batches only. For other types, record a SALE event.",
        },
        { status: 400 },
      );
    }
    if (!batch.contract) {
      return NextResponse.json(
        {
          error:
            "This batch isn't linked to a contract — link one before recording a lift.",
        },
        { status: 400 },
      );
    }
    if (d.count > batch.currentCount) {
      return NextResponse.json(
        { error: `Only ${batch.currentCount} live birds in this batch` },
        { status: 400 },
      );
    }

    // Source resolution (where the payout cheque deposits).
    let resolvedAccountId: string | null = d.accountId ?? null;
    if (d.cardId) {
      const card = await prisma.card.findUnique({
        where: { id: d.cardId },
        select: {
          workspaceId: true,
          accountId: true,
          ownerUserId: true,
          sharedWithUserIds: true,
        },
      });
      if (!card || card.workspaceId !== ctx.workspaceId) {
        return NextResponse.json({ error: "Card not found" }, { status: 404 });
      }
      if (!canAccessRecord(session, card)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      resolvedAccountId = card.accountId ?? resolvedAccountId;
    }
    if (resolvedAccountId) {
      const acc = await prisma.account.findUnique({
        where: { id: resolvedAccountId },
        select: {
          workspaceId: true,
          ownerUserId: true,
          sharedWithUserIds: true,
        },
      });
      if (!acc || acc.workspaceId !== ctx.workspaceId) {
        return NextResponse.json({ error: "Account not found" }, { status: 404 });
      }
      if (!canAccessRecord(session, acc)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }
    if (!resolvedAccountId && !d.cardId) {
      return NextResponse.json(
        { error: "Pick the account / card where the payout deposits" },
        { status: 400 },
      );
    }

    const liftDate = new Date(d.date);
    const avgKg = +(d.totalWeightKg / d.count).toFixed(3);

    // Pull existing logs so analytics can compute the final payout *as
    // if* the lift had already been recorded. We pass the synthetic
    // SALE event + EXIT weighing into the helper so the same math runs.
    const [events, feedLogs, weighings, mortality] = await Promise.all([
      prisma.livestockEvent.findMany({ where: { batchId: id } }),
      prisma.feedLog.findMany({ where: { batchId: id } }),
      prisma.weighingLog.findMany({ where: { batchId: id } }),
      prisma.mortalityLog.findMany({ where: { batchId: id } }),
    ]);

    // computeBatchAnalytics types its inputs against the strict Prisma
    // shapes (Decimal columns), but its math only calls .toString() on
    // them — JS numbers satisfy that contract at runtime. Cast through
    // unknown for the synthetic SALE event + EXIT weighing we splice
    // in for the projected payout.
    const projectedAnalytics = computeBatchAnalytics({
      batch: {
        ...batch,
        currentCount: batch.currentCount - d.count,
      },
      events: [
        ...events,
        {
          eventType: LivestockEventType.SALE,
          count: d.count,
          avgWeightKg: avgKg,
          totalWeightKg: d.totalWeightKg,
          date: liftDate,
        } as unknown as (typeof events)[number],
      ],
      feedLogs,
      weighings: [
        ...weighings,
        {
          phase: WeighingPhase.EXIT,
          avgKg,
          totalKg: d.totalWeightKg,
          sampleSize: d.count,
          date: liftDate,
        } as unknown as (typeof weighings)[number],
      ],
      mortality,
      contract: batch.contract,
    });
    const payout = projectedAnalytics.contractPayout;
    if (!payout) {
      return NextResponse.json(
        {
          error:
            "Couldn't compute payout — check the contract rate / batch arrival weight.",
        },
        { status: 400 },
      );
    }

    const description = (() => {
      const lines = [
        `${batch.contract.integratorName} lift · ${d.count} birds @ ${avgKg} kg avg`,
        `Base ₹${payout.basePayout.toLocaleString("en-IN")}`,
      ];
      if (payout.fcrBonusAmount > 0)
        lines.push(`FCR bonus +₹${payout.fcrBonusAmount.toLocaleString("en-IN")}`);
      if (payout.mortalityPenaltyAmount > 0)
        lines.push(
          `Mortality penalty −₹${payout.mortalityPenaltyAmount.toLocaleString("en-IN")}`,
        );
      return lines.join(" · ");
    })();

    const result = await prisma.$transaction(async (tx) => {
      const txn = await tx.transaction.create({
        data: {
          workspaceId: ctx.workspaceId,
          type: TransactionType.INCOME,
          kind: TransactionKind.CONTRACT_PAYOUT,
          amount: payout.expectedPayout,
          description: d.notes?.trim() || description,
          date: liftDate,
          accountId: resolvedAccountId,
          cardId: d.cardId ?? null,
          livestockBatchId: id,
          userId: ctx.userId,
          createdByUserId: ctx.userId,
        },
      });
      const event = await tx.livestockEvent.create({
        data: {
          batchId: id,
          eventType: LivestockEventType.SALE,
          date: liftDate,
          count: d.count,
          avgWeightKg: avgKg,
          totalWeightKg: d.totalWeightKg,
          unitValue: +(payout.expectedPayout / d.count).toFixed(2),
          notes: `Lift — ${batch.contract!.integratorName}`,
          transactionId: txn.id,
        },
      });
      await tx.weighingLog.create({
        data: {
          batchId: id,
          phase: WeighingPhase.EXIT,
          date: liftDate,
          sampleSize: d.count,
          totalKg: d.totalWeightKg,
          avgKg,
          notes: `Lift weighing — ${batch.contract!.integratorName}`,
        },
      });
      await tx.livestockBatch.update({
        where: { id },
        data: {
          currentCount: { decrement: d.count },
          ...(d.closeBatch
            ? { active: false, endDate: liftDate }
            : {}),
        },
      });
      return { transactionId: txn.id, eventId: event.id, payout };
    });

    return NextResponse.json(result);
  } catch (e) {
    return err(e);
  }
}
