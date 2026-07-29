import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { utilityBillPaySchema } from "@/lib/validators-domain";
import { canAccessRecord } from "@/lib/permissions";
import { sendPaymentConfirmationEmail } from "@/lib/notifications-payment";
import { resolveUtilityCategoryId } from "@/lib/utility-category";
import { billDescription } from "@/lib/bill-schedule";
import {
  ADVANCE_NONNEG_MESSAGE,
  isAdvanceNonNegViolation,
} from "@/lib/utility-advance-guard";
import {
  ReminderStatus,
  TransactionKind,
  TransactionType,
  type UtilityBill,
  type UtilityProvider,
} from "@/generated/prisma/client";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  if (isAdvanceNonNegViolation(e)) {
    return NextResponse.json({ error: ADVANCE_NONNEG_MESSAGE }, { status: 409 });
  }
  console.error("[utility-bills/[id]/pay]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

/**
 * Pay a utility bill. The math:
 *   advanceApplied = min(advanceBalance, billAmount, requested)
 *   cashAmount     = billAmount - advanceApplied
 *
 * When cashAmount > 0 a source (accountId XOR cardId) must be supplied.
 * When cashAmount == 0 we still create a zero-amount Transaction so the
 * bill has a paidTransactionId — keeps every read path uniform.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireWorkspace("bills", "write");
    const session = await auth();
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const parsed = utilityBillPaySchema.safeParse(body ?? {});
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const d = parsed.data;

    const bill = (await (
      prisma.utilityBill.findFirst as unknown as (a: {
        where: { id: string; workspaceId: string };
      }) => Promise<UtilityBill | null>
    )({ where: { id, workspaceId: ctx.workspaceId } }));
    if (!bill) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (bill.paidAt) {
      return NextResponse.json(
        { error: "Bill is already paid" },
        { status: 409 },
      );
    }

    const provider = (await (
      prisma.utilityProvider.findFirst as unknown as (a: {
        where: { id: string };
      }) => Promise<UtilityProvider | null>
    )({ where: { id: bill.providerId } }));
    if (!provider) {
      return NextResponse.json({ error: "Provider not found" }, { status: 404 });
    }

    const billAmount = Number(bill.billAmount);
    const available = Number(provider.advanceBalance);
    const requested = d.advanceApplied ?? 0;
    const cap = Math.min(available, billAmount);
    const advanceApplied = Math.max(0, Math.min(requested, cap));
    const cashAmount = +(billAmount - advanceApplied).toFixed(2);

    // Source resolution: an EXPLICIT override (accountId or cardId
    // present in the request, even if null) takes precedence over the
    // provider's default — otherwise picking a card while the provider
    // defaults to an account would leave both set and fail XOR.
    const explicitSource =
      d.accountId !== undefined || d.cardId !== undefined;
    let resolvedAccountId: string | null = explicitSource
      ? (d.accountId ?? null)
      : provider.accountId;
    const resolvedCardId: string | null = explicitSource
      ? (d.cardId ?? null)
      : provider.cardId;

    if (cashAmount > 0) {
      if (!resolvedAccountId && !resolvedCardId) {
        return NextResponse.json(
          {
            error: `Cash portion is ₹${cashAmount.toLocaleString("en-IN")} — pick an account or card`,
          },
          { status: 400 },
        );
      }
      if (resolvedAccountId && resolvedCardId) {
        return NextResponse.json(
          { error: "Pick exactly one source" },
          { status: 400 },
        );
      }
    }
    // Resolve a human-readable source name for the confirmation email so
    // it matches the autopay format ("HDFC Credit") rather than the
    // generic "Card" / "Account". Look up whichever side the user picked.
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
      // Route to companion account for balance math (same as transactions POST).
      resolvedAccountId = card.accountId ?? resolvedAccountId;
    }
    // Validate the account leg too — when the user supplies an explicit
    // `accountId` (not falling back to the provider's default), we must
    // confirm it belongs to the workspace and the caller can access it.
    // The companion-account routing from `card.accountId` above is
    // already in-workspace (the card lookup validated it), so we only
    // re-check when the caller's input was explicit and not card-driven.
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

    const paidOn = d.paidOn ? new Date(d.paidOn) : new Date();
    if (Number.isNaN(paidOn.getTime())) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }

    // Stamp the matching utility category so cashflow / PnL reports
    // bucket the spend correctly. Falls back to null if the seed is
    // missing — the pay flow continues either way.
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
          amount: cashAmount,
          description:
            d.notes?.trim() ||
            billDescription({
              kind: provider.kind,
              providerName: provider.providerName,
              billDate: bill.billDate,
              cycle: provider.billingCycle,
              // The window the bill itself states, when recorded — the
              // cycle-derived guess would misdescribe an off-cycle bill,
              // and this string is permanent in the ledger.
              period: bill,
            }),
          date: paidOn,
          categoryId,
          accountId: cashAmount > 0 ? resolvedAccountId : null,
          cardId: cashAmount > 0 ? resolvedCardId : null,
          utilityProviderId: provider.id,
          utilityBillId: bill.id,
          userId: ctx.userId,
          createdByUserId: ctx.userId,
        },
      });
      await tx.utilityBill.update({
        where: { id: bill.id },
        data: {
          paidAt: paidOn,
          paidTransactionId: txn.id,
          advanceApplied,
        },
      });
      // Read the post-update advance back inside the same transaction so
      // the confirmation email shows the true remaining balance even
      // under concurrent pays (read-then-display from the request-time
      // snapshot would otherwise be stale).
      let remainingAdvance = available;
      if (advanceApplied > 0) {
        const updated = await tx.utilityProvider.update({
          where: { id: provider.id },
          data: { advanceBalance: { decrement: advanceApplied } },
          select: { advanceBalance: true },
        });
        remainingAdvance = Number(updated.advanceBalance);
      }
      await tx.investmentReminder.updateMany({
        where: { utilityBillId: bill.id },
        data: {
          status: ReminderStatus.CONFIRMED,
          confirmedTransactionId: txn.id,
        },
      });
      return {
        transactionId: txn.id,
        advanceApplied,
        cashAmount,
        remainingAdvance,
      };
    });

    void sendPaymentConfirmationEmail({
      workspaceId: ctx.workspaceId,
      recipientUserIds: [ctx.userId],
      kind: "UTILITY_BILL",
      autopayed: false,
      amount: billAmount,
      label: `${provider.providerName} bill`,
      sourceLabel:
        cashAmount > 0
          ? (cardName ?? accountName ?? "default source")
          : "advance balance",
      cashAmount: result.cashAmount,
      advanceApplied: result.advanceApplied,
      remainingAdvance: result.remainingAdvance,
      link: `/bills/providers/${provider.id}`,
    }).catch((e) => console.warn("[bill-pay] email failed", e));

    return NextResponse.json(result);
  } catch (e) {
    return err(e);
  }
}
