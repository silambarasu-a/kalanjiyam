import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { canAccessRecord } from "@/lib/permissions";
import { reminderConfirmSchema } from "@/lib/validators-domain";
import {
  ReminderKind,
  ReminderStatus,
  TransactionType,
  InvestmentAction,
  TransactionKind,
} from "@/generated/prisma/client";
import { advanceDate } from "@/lib/reminder-schedule";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[reminders/confirm]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

/**
 * Confirm a pending reminder. The exact side-effect depends on the kind:
 *   SIP_BUY            → INVESTMENT transaction (BUY), advance investment nextDueDate
 *   INSURANCE_PREMIUM  → INVESTMENT transaction (BUY), advance investment nextDueDate
 *   FD_INTEREST        → INCOME transaction, increase investment.currentValue
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireWorkspace("reminders", "write");
    const session = await auth();
    const { id } = await context.params;
    const reminder = await prisma.investmentReminder.findUnique({
      where: { id },
      include: { investment: true },
    });
    if (!reminder || reminder.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (reminder.status !== "UPCOMING") {
      return NextResponse.json({ error: "Already processed" }, { status: 400 });
    }
    const body = await request.json();
    const parsed = reminderConfirmSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    let resolvedAccountId: string | null = parsed.data.accountId ?? null;
    if (parsed.data.cardId) {
      const card = await prisma.card.findUnique({ where: { id: parsed.data.cardId } });
      if (!card || card.workspaceId !== ctx.workspaceId) {
        return NextResponse.json({ error: "Card not found" }, { status: 404 });
      }
      if (!canAccessRecord(session, card)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      resolvedAccountId = card.accountId ?? resolvedAccountId;
    }
    if (!resolvedAccountId) {
      return NextResponse.json({ error: "Pick an account or card" }, { status: 400 });
    }

    const inv = reminder.investment;
    const fallbackAmount =
      reminder.amount != null
        ? Number(reminder.amount)
        : inv?.premiumAmount != null
          ? Number(inv.premiumAmount)
          : 0;
    const amount = parsed.data.amount ?? fallbackAmount;
    if (!amount || amount <= 0) {
      return NextResponse.json({ error: "Amount required" }, { status: 400 });
    }
    const date = parsed.data.date ? new Date(parsed.data.date) : new Date();

    await prisma.$transaction(async (tx) => {
      let createdTxnId: string | null = null;

      if (
        reminder.kind === ReminderKind.SIP_BUY ||
        reminder.kind === ReminderKind.INSURANCE_PREMIUM
      ) {
        const txn = await tx.transaction.create({
          data: {
            workspaceId: ctx.workspaceId,
            type: TransactionType.INVESTMENT,
            amount,
            description: `${reminder.kind === "SIP_BUY" ? "SIP buy" : "Premium"} · ${inv?.name ?? ""}${parsed.data.notes ? ` · ${parsed.data.notes}` : ""}`,
            date,
            accountId: resolvedAccountId,
            cardId: parsed.data.cardId ?? null,
            investmentId: inv?.id ?? null,
            investmentAction: InvestmentAction.BUY,
            userId: ctx.userId,
            createdByUserId: ctx.userId,
          },
        });
        createdTxnId = txn.id;
        // Advance the investment's nextDueDate by its frequency and track
        // cumulative amount invested.
        if (inv?.premiumFrequency && inv.nextDueDate) {
          await tx.investment.update({
            where: { id: inv.id },
            data: {
              amount: Number(inv.amount) + amount,
              nextDueDate: advanceDate(inv.nextDueDate, inv.premiumFrequency),
            },
          });
        } else if (inv) {
          await tx.investment.update({
            where: { id: inv.id },
            data: { amount: Number(inv.amount) + amount },
          });
        }
      } else if (reminder.kind === ReminderKind.FD_INTEREST) {
        const txn = await tx.transaction.create({
          data: {
            workspaceId: ctx.workspaceId,
            type: TransactionType.INCOME,
            kind: TransactionKind.INTEREST,
            amount,
            description: `FD interest · ${inv?.name ?? ""}`,
            date,
            accountId: resolvedAccountId,
            cardId: parsed.data.cardId ?? null,
            investmentId: inv?.id ?? null,
            userId: ctx.userId,
            createdByUserId: ctx.userId,
          },
        });
        createdTxnId = txn.id;
        if (inv) {
          await tx.investment.update({
            where: { id: inv.id },
            data: { currentValue: (Number(inv.currentValue ?? inv.amount) + amount) },
          });
        }
      }

      await tx.investmentReminder.update({
        where: { id },
        data: {
          status: ReminderStatus.CONFIRMED,
          confirmedTransactionId: createdTxnId,
        },
      });
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}
