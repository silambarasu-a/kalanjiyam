import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { advanceCycle } from "@/lib/cascades";
import {
  ReminderKind,
  ReminderStatus,
  SubscriptionCycle,
  SubscriptionStatus,
  TransactionKind,
  TransactionType,
} from "@/generated/prisma/client";
import { sendPaymentConfirmationEmail } from "@/lib/notifications-payment";

/**
 * Daily auto-pay sweep. Runs ACTIVE subscriptions and pending utility
 * bills where `autoPay=true` and the next billing / due date is today
 * or in the past, recording the same transaction the user would have
 * recorded manually. The bank/card is assumed to have actually moved
 * the money — this endpoint just keeps the ledger in sync.
 *
 * Curl from dev:
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
 *     http://localhost:3003/api/cron/autopay
 */
function authorize(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const got = request.headers.get("authorization") ?? "";
  return got === `Bearer ${expected}`;
}

export async function POST(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return run();
}
export async function GET(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return run();
}

async function run() {
  const today = new Date();
  today.setUTCHours(23, 59, 59, 999);

  const subsPaid = await runSubscriptions(today);
  const billsPaid = await runBills(today);

  return NextResponse.json({
    ok: true,
    subscriptionsPaid: subsPaid.count,
    subscriptionFailures: subsPaid.failures,
    billsPaid: billsPaid.count,
    billFailures: billsPaid.failures,
  });
}

async function runSubscriptions(today: Date) {
  const subs = await prisma.subscription.findMany({
    where: {
      status: SubscriptionStatus.ACTIVE,
      autoPay: true,
      nextBillingDate: { lte: today },
    },
    include: {
      account: { select: { id: true, name: true } },
      card: { select: { id: true, name: true, accountId: true } },
      workspace: { select: { name: true, ownerUserId: true } },
    },
    take: 500,
  });

  let count = 0;
  const failures: { id: string; reason: string }[] = [];
  for (const sub of subs) {
    try {
      // Find the open schedule row whose dueDate matches the current
      // billing date — that's the one we're confirming.
      const schedule = await prisma.subscriptionSchedule.findFirst({
        where: {
          subscriptionId: sub.id,
          status: ReminderStatus.UPCOMING,
          dueDate: sub.nextBillingDate,
        },
      });
      if (!schedule) {
        failures.push({ id: sub.id, reason: "No matching schedule row" });
        continue;
      }
      const accountId = sub.accountId;
      const cardId = sub.cardId;
      if (!accountId && !cardId) {
        failures.push({ id: sub.id, reason: "No payment source on subscription" });
        continue;
      }
      let resolvedAccountId: string | null = accountId;
      if (cardId) {
        resolvedAccountId = sub.card?.accountId ?? resolvedAccountId;
      }
      const amount = Number(sub.amount);
      // Transaction.userId is a User FK — never a Workspace id. Fall
      // back to the workspace owner when the subscription has no owner.
      const authorUserId = sub.ownerUserId ?? sub.workspace.ownerUserId;
      if (!authorUserId) {
        failures.push({ id: sub.id, reason: "No author user (workspace orphaned?)" });
        continue;
      }
      const result = await prisma.$transaction(async (tx) => {
        const txn = await tx.transaction.create({
          data: {
            workspaceId: sub.workspaceId,
            type: TransactionType.EXPENSE,
            kind: TransactionKind.SUBSCRIPTION,
            amount,
            description: `${sub.name} · auto-pay`,
            date: new Date(),
            accountId: resolvedAccountId,
            cardId,
            categoryId: sub.categoryId,
            subscriptionId: sub.id,
            subscriptionScheduleId: schedule.id,
            userId: authorUserId,
            createdByUserId: authorUserId,
          },
        });
        await tx.subscriptionSchedule.update({
          where: { id: schedule.id },
          data: { status: ReminderStatus.CONFIRMED },
        });
        await tx.investmentReminder.updateMany({
          where: { subscriptionScheduleId: schedule.id },
          data: {
            status: ReminderStatus.CONFIRMED,
            confirmedTransactionId: txn.id,
          },
        });
        const nextDue = advanceCycle(sub.nextBillingDate, sub.cycle);
        const beyondEnd = sub.endsOn && nextDue > sub.endsOn;
        const nextStatus =
          !beyondEnd ? SubscriptionStatus.ACTIVE : SubscriptionStatus.CANCELLED;
        await tx.subscription.update({
          where: { id: sub.id },
          data: { nextBillingDate: nextDue, status: nextStatus },
        });
        if (nextStatus === SubscriptionStatus.ACTIVE) {
          const next = await tx.subscriptionSchedule.create({
            data: {
              subscriptionId: sub.id,
              dueDate: nextDue,
              amount,
              status: ReminderStatus.UPCOMING,
            },
          });
          await tx.investmentReminder.create({
            data: {
              workspaceId: sub.workspaceId,
              subscriptionId: sub.id,
              subscriptionScheduleId: next.id,
              kind: ReminderKind.SUBSCRIPTION_RENEWAL,
              dueDate: nextDue,
              amount,
            },
          });
        }
        return { txnId: txn.id, nextDue };
      });
      count++;
      // Send confirmation email — autopay targets the subscription
      // owner only (not the whole workspace) to avoid notification spam
      // on shared workspaces.
      await sendPaymentConfirmationEmail({
        workspaceId: sub.workspaceId,
        recipientUserIds: [authorUserId],
        kind: "SUBSCRIPTION",
        autopayed: true,
        amount,
        label: sub.name,
        sourceLabel:
          sub.card?.name ??
          sub.account?.name ??
          "default source",
        cycleLabel: cycleHuman(sub.cycle),
        nextDate: result.nextDue,
        link: `/subscriptions/${sub.id}`,
      }).catch((e) => console.warn("[autopay] email failed", e));
    } catch (e) {
      failures.push({
        id: sub.id,
        reason: e instanceof Error ? e.message : "unknown",
      });
    }
  }
  return { count, failures };
}

async function runBills(today: Date) {
  const bills = await prisma.utilityBill.findMany({
    where: {
      paidAt: null,
      dueDate: { lte: today },
      provider: { autoPay: true, status: "ACTIVE" },
    },
    include: {
      provider: {
        select: {
          id: true,
          providerName: true,
          accountId: true,
          cardId: true,
          card: { select: { name: true, accountId: true } },
          account: { select: { name: true } },
          advanceBalance: true,
          ownerUserId: true,
        },
      },
      workspace: { select: { ownerUserId: true } },
    },
    take: 500,
  });

  let count = 0;
  const failures: { id: string; reason: string }[] = [];
  for (const bill of bills) {
    try {
      const provider = bill.provider;
      const billAmount = Number(bill.billAmount);
      const available = Number(provider.advanceBalance);
      const advanceApplied = Math.min(available, billAmount);
      const cashAmount = +(billAmount - advanceApplied).toFixed(2);

      let resolvedAccountId: string | null = provider.accountId;
      const resolvedCardId: string | null = provider.cardId;
      if (resolvedCardId) {
        resolvedAccountId = provider.card?.accountId ?? resolvedAccountId;
      }
      if (cashAmount > 0 && !resolvedAccountId && !resolvedCardId) {
        failures.push({
          id: bill.id,
          reason: `Cash portion ₹${cashAmount.toFixed(2)} but no default source set`,
        });
        continue;
      }

      // Transaction.userId is a User FK — fall back to the workspace
      // owner when the provider has no owner.
      const authorUserId =
        provider.ownerUserId ?? bill.workspace.ownerUserId;
      if (!authorUserId) {
        failures.push({
          id: bill.id,
          reason: "No author user (workspace orphaned?)",
        });
        continue;
      }
      const paidOn = new Date();
      const txnId = await prisma.$transaction(async (tx) => {
        const txn = await tx.transaction.create({
          data: {
            workspaceId: bill.workspaceId,
            type: TransactionType.EXPENSE,
            kind: TransactionKind.UTILITY_BILL,
            amount: cashAmount,
            description: `${provider.providerName} bill · auto-pay`,
            date: paidOn,
            accountId: cashAmount > 0 ? resolvedAccountId : null,
            cardId: cashAmount > 0 ? resolvedCardId : null,
            utilityProviderId: provider.id,
            utilityBillId: bill.id,
            userId: authorUserId,
            createdByUserId: authorUserId,
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
        return txn.id;
      });
      count++;
      void txnId;
      await sendPaymentConfirmationEmail({
        workspaceId: bill.workspaceId,
        recipientUserIds: [authorUserId],
        kind: "UTILITY_BILL",
        autopayed: true,
        amount: billAmount,
        cashAmount,
        advanceApplied,
        remainingAdvance: Math.max(0, available - advanceApplied),
        label: `${provider.providerName} bill`,
        sourceLabel:
          cashAmount > 0
            ? (provider.card?.name ?? provider.account?.name ?? "default source")
            : "advance balance",
        link: `/bills/providers/${provider.id}`,
      }).catch((e) => console.warn("[autopay] bill email failed", e));
    } catch (e) {
      failures.push({
        id: bill.id,
        reason: e instanceof Error ? e.message : "unknown",
      });
    }
  }
  return { count, failures };
}

function cycleHuman(c: SubscriptionCycle): string {
  return (
    {
      WEEKLY: "weekly",
      MONTHLY: "monthly",
      QUARTERLY: "quarterly",
      HALF_YEARLY: "half-yearly",
      YEARLY: "yearly",
    } as const
  )[c];
}
