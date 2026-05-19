import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { utilityBillPaySchema } from "@/lib/validators-domain";
import { canAccessRecord } from "@/lib/permissions";
import { sendPaymentConfirmationEmail } from "@/lib/notifications-payment";
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
    if (resolvedCardId) {
      const card = await prisma.card.findUnique({
        where: { id: resolvedCardId },
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
      // Route to companion account for balance math (same as transactions POST).
      resolvedAccountId = card.accountId ?? resolvedAccountId;
    }

    const paidOn = d.paidOn ? new Date(d.paidOn) : new Date();
    if (Number.isNaN(paidOn.getTime())) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const txn = await tx.transaction.create({
        data: {
          workspaceId: ctx.workspaceId,
          type: TransactionType.EXPENSE,
          kind: TransactionKind.UTILITY_BILL,
          amount: cashAmount,
          description:
            d.notes?.trim() || `${provider.providerName} bill`,
          date: paidOn,
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
      if (advanceApplied > 0) {
        await tx.utilityProvider.update({
          where: { id: provider.id },
          data: { advanceBalance: { decrement: advanceApplied } },
        });
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
        cashAmount > 0 ? (resolvedCardId ? "Card" : "Account") : "advance balance",
      cashAmount: result.cashAmount,
      advanceApplied: result.advanceApplied,
      remainingAdvance: Math.max(0, available - result.advanceApplied),
      link: `/bills/providers/${provider.id}`,
    }).catch((e) => console.warn("[bill-pay] email failed", e));

    return NextResponse.json(result);
  } catch (e) {
    return err(e);
  }
}
