import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { advanceCycle } from "@/lib/cascades";
import {
  NotificationKind,
  ReminderKind,
  ReminderStatus,
  SubscriptionCycle,
  SubscriptionStatus,
  TransactionKind,
  TransactionType,
} from "@/generated/prisma/client";
import {
  sendPaymentConfirmationEmail,
  sendPaymentFailedEmail,
} from "@/lib/notifications-payment";
import { createNotification } from "@/lib/notifications";
import { billDescription, subscriptionDescription } from "@/lib/bill-schedule";
import { resolveUtilityCategoryId } from "@/lib/utility-category";
import { isAdvanceNonNegViolation } from "@/lib/utility-advance-guard";

/**
 * Report an auto-pay failure: a targeted in-app PAYMENT_FAILED
 * notification plus (when we know the owner) a failure email so the user
 * can settle it by hand. Best-effort — never throws into the sweep loop.
 */
async function reportAutopayFailure(opts: {
  workspaceId: string;
  recipientUserId: string | null;
  kind: "UTILITY_BILL" | "SUBSCRIPTION";
  label: string;
  amount: number;
  reason: string;
  link: string;
}): Promise<void> {
  await createNotification({
    workspaceId: opts.workspaceId,
    userId: opts.recipientUserId ?? undefined,
    kind: NotificationKind.PAYMENT_FAILED,
    title: `Auto-pay failed: ${opts.label}`,
    body: opts.reason,
    link: opts.link,
    skipEmail: true, // richer email sent below
  }).catch((e) => console.warn("[autopay] failure notification failed", e));

  if (opts.recipientUserId) {
    await sendPaymentFailedEmail({
      workspaceId: opts.workspaceId,
      recipientUserIds: [opts.recipientUserId],
      kind: opts.kind,
      label: opts.label,
      amount: opts.amount,
      reason: opts.reason,
      link: opts.link,
    }).catch((e) => console.warn("[autopay] failure email failed", e));
  }
}

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
    const amount = Number(sub.amount);
    const recipientUserId = sub.ownerUserId ?? sub.workspace.ownerUserId ?? null;
    const fail = async (reason: string) => {
      failures.push({ id: sub.id, reason });
      await reportAutopayFailure({
        workspaceId: sub.workspaceId,
        recipientUserId,
        kind: "SUBSCRIPTION",
        label: sub.name,
        amount,
        reason,
        link: `/subscriptions/${sub.id}`,
      });
    };
    try {
      // Find the open schedule row whose dueDate matches the current
      // billing date — that's the one we're confirming. Cast through
      // `unknown` to dodge the Prisma 7 deep-instantiation quirk that
      // fires once the schema grows past a threshold (same trick used in
      // the utility-bill routes).
      const schedule = (await (
        prisma.subscriptionSchedule.findFirst as unknown as (a: {
          where: {
            subscriptionId: string;
            status: ReminderStatus;
            dueDate: Date;
          };
        }) => Promise<{ id: string } | null>
      )({
        where: {
          subscriptionId: sub.id,
          status: ReminderStatus.UPCOMING,
          dueDate: sub.nextBillingDate,
        },
      }));
      if (!schedule) {
        await fail("No matching schedule row");
        continue;
      }
      const accountId = sub.accountId;
      const cardId = sub.cardId;
      if (!accountId && !cardId) {
        await fail("No payment source on subscription");
        continue;
      }
      let resolvedAccountId: string | null = accountId;
      if (cardId) {
        resolvedAccountId = sub.card?.accountId ?? resolvedAccountId;
      }
      // Transaction.userId is a User FK — never a Workspace id. Fall
      // back to the workspace owner when the subscription has no owner.
      const authorUserId = sub.ownerUserId ?? sub.workspace.ownerUserId;
      if (!authorUserId) {
        await fail("No author user (workspace orphaned?)");
        continue;
      }
      const result = await prisma.$transaction(async (tx) => {
        const txn = await tx.transaction.create({
          data: {
            workspaceId: sub.workspaceId,
            type: TransactionType.EXPENSE,
            kind: TransactionKind.SUBSCRIPTION,
            amount,
            description: subscriptionDescription(
              sub.name,
              sub.nextBillingDate,
              sub.cycle,
            ),
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
      await fail(e instanceof Error ? e.message : "unknown");
    }
  }
  return { count, failures };
}

async function runBills(today: Date) {
  // Pull every unpaid, NON-estimated bill within the widest possible lead
  // window (max lead = 31 days); the per-bill lead check below decides
  // whether each one is due to pay yet. Estimated (VARIABLE placeholder)
  // bills are excluded — autopay never guesses an amount.
  const leadHorizon = new Date(today);
  leadHorizon.setUTCDate(leadHorizon.getUTCDate() + 31);
  const bills = await prisma.utilityBill.findMany({
    where: {
      paidAt: null,
      estimated: false,
      dueDate: { lte: leadHorizon },
      // Prepaid connections are paid up front and never autopay (they also
      // have no bills), but exclude them explicitly for safety.
      provider: { autoPay: true, status: "ACTIVE", prepaid: false },
    },
    include: {
      provider: {
        select: {
          id: true,
          kind: true,
          providerName: true,
          connectionNumber: true,
          billingCycle: true,
          autoPayLeadDays: true,
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
    const provider = bill.provider;
    const billAmount = Number(bill.billAmount);
    const recipientUserId =
      provider.ownerUserId ?? bill.workspace.ownerUserId ?? null;
    const fail = async (reason: string) => {
      failures.push({ id: bill.id, reason });
      await reportAutopayFailure({
        workspaceId: bill.workspaceId,
        recipientUserId,
        kind: "UTILITY_BILL",
        label: `${provider.providerName} bill`,
        amount: billAmount,
        reason,
        link: `/bills/providers/${provider.id}`,
      });
    };
    try {
      // Lead time: pay `autoPayLeadDays` before the due date (0 = on due
      // date). Skip bills whose pay date hasn't arrived yet.
      const payOn = new Date(bill.dueDate);
      payOn.setUTCDate(payOn.getUTCDate() - (provider.autoPayLeadDays ?? 0));
      if (payOn > today) continue;

      const available = Number(provider.advanceBalance);
      const advanceApplied = Math.min(available, billAmount);
      const cashAmount = +(billAmount - advanceApplied).toFixed(2);

      let resolvedAccountId: string | null = provider.accountId;
      const resolvedCardId: string | null = provider.cardId;
      if (resolvedCardId) {
        resolvedAccountId = provider.card?.accountId ?? resolvedAccountId;
      }
      if (cashAmount > 0 && !resolvedAccountId && !resolvedCardId) {
        await fail(
          `Cash portion ₹${cashAmount.toFixed(2)} but no default source set`,
        );
        continue;
      }

      // Transaction.userId is a User FK — fall back to the workspace
      // owner when the provider has no owner.
      const authorUserId =
        provider.ownerUserId ?? bill.workspace.ownerUserId;
      if (!authorUserId) {
        await fail("No author user (workspace orphaned?)");
        continue;
      }
      const paidOn = new Date();
      const categoryId = await resolveUtilityCategoryId(
        bill.workspaceId,
        provider.kind,
      );
      const result = await prisma.$transaction(async (tx) => {
        const txn = await tx.transaction.create({
          data: {
            workspaceId: bill.workspaceId,
            type: TransactionType.EXPENSE,
            kind: TransactionKind.UTILITY_BILL,
            amount: cashAmount,
            description: billDescription({
              kind: provider.kind,
              providerName: provider.providerName,
              billDate: bill.billDate,
              cycle: provider.billingCycle,
              // Prefer the window recorded on the bill over the cycle
              // guess — see the manual pay route.
              period: bill,
            }),
            date: paidOn,
            categoryId,
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
        // Re-read the post-decrement balance from inside the same
        // transaction so the email's remaining-advance figure stays
        // truthful even if another sweep / manual pay decremented this
        // provider concurrently.
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
        return { txnId: txn.id, remainingAdvance };
      });
      count++;
      void result.txnId;
      await sendPaymentConfirmationEmail({
        workspaceId: bill.workspaceId,
        recipientUserIds: [authorUserId],
        kind: "UTILITY_BILL",
        autopayed: true,
        amount: billAmount,
        cashAmount,
        advanceApplied,
        remainingAdvance: result.remainingAdvance,
        label: `${provider.providerName} bill`,
        sourceLabel:
          cashAmount > 0
            ? (provider.card?.name ?? provider.account?.name ?? "default source")
            : "advance balance",
        link: `/bills/providers/${provider.id}`,
      }).catch((e) => console.warn("[autopay] bill email failed", e));
    } catch (e) {
      // Advance-balance race: another caller decremented the same
      // balance to zero before us. Bill stays unpaid; the next sweep
      // (or the user) will retry against the fresh balance. Transient —
      // don't alarm the user, just record it for the run summary.
      if (isAdvanceNonNegViolation(e)) {
        failures.push({
          id: bill.id,
          reason:
            "Advance balance changed during sweep — bill will retry on the next run.",
        });
        continue;
      }
      await fail(e instanceof Error ? e.message : "unknown");
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
