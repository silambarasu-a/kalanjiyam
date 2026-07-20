import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { utilityRechargeSchema } from "@/lib/validators-domain";
import { canAccessRecord, canModifyRecord } from "@/lib/permissions";
import { sendPaymentConfirmationEmail } from "@/lib/notifications-payment";
import { resolveUtilityCategoryId } from "@/lib/utility-category";
import { resyncPrepaidReminder } from "@/lib/prepaid-reminder";
import {
  computeRechargeExpiry,
  formatBillDate,
  utilityKindLabel,
} from "@/lib/bill-schedule";
import {
  TransactionKind,
  TransactionType,
} from "@/generated/prisma/client";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[utility-providers/[id]/recharge]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

/**
 * Recharge a prepaid connection (JioAirFiber, mobile prepaid, …). Records
 * the up-front payment as an EXPENSE transaction and extends the
 * provider's validity, then re-points the single UTILITY_RECHARGE_DUE
 * reminder onto the new expiry so the daily sweep warns before it lapses.
 *
 * The new expiry is EITHER an explicit `validUntil` date OR
 * `validityDays` added to a base date. When `extendFromCurrent` (default)
 * and the plan is still live, the fresh days STACK onto the remaining
 * validity — matching how prepaid ISPs/telcos add days on early recharge.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireWorkspace("bills", "write");
    const session = await auth();
    const { id } = await context.params;

    const provider = await prisma.utilityProvider.findUnique({ where: { id } });
    if (!provider || provider.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!canModifyRecord(session, provider)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (!provider.prepaid) {
      return NextResponse.json(
        { error: "This connection isn't prepaid — record a bill instead" },
        { status: 400 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const parsed = utilityRechargeSchema.safeParse(body ?? {});
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const d = parsed.data;

    const paidOn = d.paidOn ? new Date(d.paidOn) : new Date();
    if (Number.isNaN(paidOn.getTime())) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }

    // Resolve the new validity expiry: an explicit date wins; otherwise
    // add the plan's validity days (stacking onto remaining days when the
    // plan is still live and extendFromCurrent is on).
    let newValidUntil: Date;
    if (d.validUntil && d.validUntil.trim()) {
      const v = new Date(d.validUntil);
      if (Number.isNaN(v.getTime())) {
        return NextResponse.json({ error: "Invalid expiry date" }, { status: 400 });
      }
      v.setUTCHours(0, 0, 0, 0);
      const paidMidnight = new Date(paidOn);
      paidMidnight.setUTCHours(0, 0, 0, 0);
      if (v < paidMidnight) {
        return NextResponse.json(
          { error: "Expiry date can't be before the recharge date" },
          { status: 400 },
        );
      }
      newValidUntil = v;
    } else {
      // validityDays is guaranteed present here by the Zod refinement.
      newValidUntil = computeRechargeExpiry({
        paidOn,
        validityDays: d.validityDays!,
        currentValidUntil: provider.validUntil,
        extendFromCurrent: d.extendFromCurrent,
      });
    }

    // Payment source: an explicit override wins over the provider default.
    const explicitSource = d.accountId !== undefined || d.cardId !== undefined;
    let resolvedAccountId: string | null = explicitSource
      ? (d.accountId ?? null)
      : provider.accountId;
    const resolvedCardId: string | null = explicitSource
      ? (d.cardId ?? null)
      : provider.cardId;

    if (!resolvedAccountId && !resolvedCardId) {
      return NextResponse.json(
        { error: "Pick an account or card to pay from" },
        { status: 400 },
      );
    }
    if (resolvedAccountId && resolvedCardId) {
      return NextResponse.json(
        { error: "Pick exactly one source" },
        { status: 400 },
      );
    }

    // Validate + resolve a human-readable source name (mirrors bill-pay).
    let cardName: string | null = null;
    let accountName: string | null = null;
    if (resolvedCardId) {
      const card = await prisma.card.findUnique({
        where: { id: resolvedCardId },
        select: {
          name: true,
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
      cardName = card.name;
      // Route card spend through its companion account for balance math.
      resolvedAccountId = card.accountId ?? resolvedAccountId;
    }
    if (!cardName && resolvedAccountId) {
      const acc = await prisma.account.findUnique({
        where: { id: resolvedAccountId },
        select: {
          name: true,
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
      accountName = acc.name;
    }

    // Bucket the spend under the same category as this kind's bills.
    const categoryId = await resolveUtilityCategoryId(
      ctx.workspaceId,
      provider.kind,
    );

    const result = await prisma.$transaction(async (tx) => {
      const txn = await tx.transaction.create({
        data: {
          workspaceId: ctx.workspaceId,
          type: TransactionType.EXPENSE,
          kind: TransactionKind.UTILITY_BILL,
          amount: d.amount,
          description:
            d.notes?.trim() ||
            `${utilityKindLabel(provider.kind)}: ${provider.providerName} recharge — valid till ${formatBillDate(newValidUntil)}`,
          date: paidOn,
          categoryId,
          accountId: resolvedAccountId,
          cardId: resolvedCardId,
          utilityProviderId: provider.id,
          userId: ctx.userId,
          createdByUserId: ctx.userId,
        },
      });
      await tx.utilityProvider.update({
        where: { id: provider.id },
        data: {
          validUntil: newValidUntil,
          // Remember the plan length so the next recharge dialog prefills.
          rechargeValidityDays:
            d.validityDays != null ? d.validityDays : undefined,
        },
      });
      // Delete-and-recreate the validity reminder on the new expiry.
      await resyncPrepaidReminder(tx, {
        workspaceId: ctx.workspaceId,
        providerId: provider.id,
        validUntil: newValidUntil,
      });
      return { transactionId: txn.id };
    });

    void sendPaymentConfirmationEmail({
      workspaceId: ctx.workspaceId,
      recipientUserIds: [ctx.userId],
      kind: "UTILITY_BILL",
      autopayed: false,
      amount: d.amount,
      label: `${provider.providerName} recharge`,
      sourceLabel: cardName ?? accountName ?? "default source",
      cashAmount: d.amount,
      link: `/bills/providers/${provider.id}`,
    }).catch((e) => console.warn("[recharge] email failed", e));

    return NextResponse.json({
      transactionId: result.transactionId,
      validUntil: newValidUntil.toISOString(),
    });
  } catch (e) {
    return err(e);
  }
}
