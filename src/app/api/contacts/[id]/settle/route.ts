import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { canAccessRecord, checkRoutePermission } from "@/lib/permissions";
import { contactBulkSettleSchema } from "@/lib/validators-domain";
import { sendPaymentConfirmationEmail } from "@/lib/notifications-payment";
import { createContactTransfer } from "@/lib/contact-transfer";
import {
  CHARGE_OVERSETTLE_MESSAGE,
  CONTACT_ADVANCE_MESSAGE,
  isChargeOverSettleViolation,
  isContactAdvanceViolation,
} from "@/lib/contact-settle-guards";
import {
  MemberChargeDirection,
  MemberChargeStatus,
  MemberChargeType,
  TransactionType,
} from "@/generated/prisma/client";

// A settle writes a chain of dependent rows and each one is a round-trip to
// a remote database. The platform default cuts the function off well before
// the transaction's own budget below, which surfaced as a bare 500.
export const maxDuration = 30;

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  if (isChargeOverSettleViolation(e)) {
    return NextResponse.json({ error: CHARGE_OVERSETTLE_MESSAGE }, { status: 409 });
  }
  if (isContactAdvanceViolation(e)) {
    return NextResponse.json({ error: CONTACT_ADVANCE_MESSAGE }, { status: 409 });
  }
  console.error("[contact-bulk-settle]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

const round2 = (n: number) => Math.round(n * 100) / 100;

type LeftoverResult = {
  amount: number;
  kind: "OBLIGATION" | "GIFT" | "ADVANCE";
  transferId: string | null;
  transactionId: string | null;
  chargeId: string | null;
};

/**
 * Bulk-settle multiple outstanding charges belonging to a single contact in
 * one round-trip, with the money that arrives driving the allocation.
 *
 * They owed ₹100 + ₹400 + ₹800 and sent ₹1500: the three charges clear and
 * the extra ₹200 is classified by the caller as a debt the other way, a
 * gift, or advance credit. Symmetric when the workspace owner overpays a
 * contact they owe.
 *
 * Three invariants hold the accounting together:
 *
 *  1. The settlement Transaction covers the ALLOCATED total only, never the
 *     received amount. The leftover carries its own record so no rupee is
 *     counted twice.
 *  2. The leftover is recorded in whichever shape the existing readers
 *     already understand — a Transfer (+ MemberCharge) for a debt or an
 *     advance, a plain EXPENSE/INCOME for a gift. A gift must NOT be a
 *     Transfer: every P&L and cashflow reader filters `transferId: null`, so
 *     gifted money would move the balance and appear in no report.
 *  3. Charges are re-read INSIDE the transaction and advanced with an atomic
 *     increment. A CHECK constraint fails the loser of a concurrent settle
 *     rather than letting an over-settle through silently.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireWorkspace("members", "write");
    const session = await auth();
    const { id: contactId } = await context.params;
    const body = await request.json();
    const parsed = contactBulkSettleSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const data = parsed.data;

    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
    });
    if (!contact || contact.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }

    const chargeIds = data.lines.map((l) => l.chargeId);
    if (new Set(chargeIds).size !== chargeIds.length) {
      return NextResponse.json(
        { error: "The same charge appears twice" },
        { status: 400 },
      );
    }

    let total = 0;
    for (const line of data.lines) total += line.amount;
    total = round2(total);

    // ── Leftover: what's left after the lines are paid ───────────────────
    // Recomputed here rather than trusted from the client, which only sends
    // it so we can confirm both sides agree on what the user was shown.
    const cashMoved = round2(data.receivedAmount ?? total);
    const leftoverAmount = round2(cashMoved - total);
    if (data.leftover) {
      if (Math.abs(leftoverAmount - data.leftover.amount) > 0.01) {
        return NextResponse.json(
          { error: "Leftover doesn't match the amounts entered — please retry" },
          { status: 400 },
        );
      }
    } else if (leftoverAmount > 0.005 && !data.fundedFromAdvance) {
      return NextResponse.json(
        {
          error: `₹${leftoverAmount.toFixed(
            2,
          )} is unaccounted for — say whether it's owed back, a gift, or advance credit`,
        },
        { status: 400 },
      );
    }

    // The leftover writes a row this route's own `members` gate doesn't
    // cover, so gate it against the feature that actually owns that row.
    if (data.leftover) {
      const feature =
        data.leftover.kind === "GIFT" ? "transactions" : "transfers";
      if (!checkRoutePermission(session, feature, "write").allowed) {
        return NextResponse.json(
          { error: "You don't have permission to record the extra amount" },
          { status: 403 },
        );
      }
    }

    // ── Resolve the cash-flow side ───────────────────────────────────────
    // Neither account nor card means audit-only: settlements are recorded
    // but no transaction moves money.
    let resolvedAccountId: string | null = data.accountId ?? null;
    const resolvedCardId: string | null = data.cardId ?? null;
    let resolvedAccountKind: string | null = null;
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
      resolvedAccountId = card.accountId ?? resolvedAccountId;
    } else if (resolvedAccountId) {
      const acc = await prisma.account.findUnique({
        where: { id: resolvedAccountId },
        select: {
          workspaceId: true,
          kind: true,
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
      resolvedAccountKind = acc.kind;
    }

    // A leftover needs somewhere real to land. A card resolves to its
    // companion CARD-kind account, whose balance runs the other way and
    // whose inbound transfers get read as bill payments — so a leftover
    // through a card would be recorded backwards.
    if (data.leftover) {
      if (resolvedCardId || resolvedAccountKind === "CARD") {
        return NextResponse.json(
          {
            error: `Pick a bank or cash account to record the extra ₹${leftoverAmount.toFixed(
              2,
            )}`,
          },
          { status: 400 },
        );
      }
      if (!resolvedAccountId) {
        return NextResponse.json(
          { error: "Pick an account to record the extra amount" },
          { status: 400 },
        );
      }
    }

    const paidAt = new Date(data.paidAt);
    if (Number.isNaN(paidAt.getTime())) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }

    const fundedFromAdvance = data.fundedFromAdvance === true;

    // ── Validate the charges BEFORE opening the transaction ──────────────
    // These reads are only for failing fast with a useful message. They are
    // deliberately NOT the thing that makes concurrent settles safe — the
    // atomic { increment } plus the MemberCharge_settled_le_amount_check
    // constraint is, and that holds however stale this snapshot gets. Doing
    // it out here keeps the interactive transaction short, which matters:
    // it has a 5s budget and every query is a round-trip to a remote
    // database.
    const charges = await prisma.memberCharge.findMany({
      where: { id: { in: chargeIds } },
    });
    if (charges.length !== chargeIds.length) {
      return NextResponse.json(
        { error: "One or more charges not found" },
        { status: 404 },
      );
    }
    for (const c of charges) {
      if (
        c.workspaceId !== ctx.workspaceId ||
        c.beneficiaryContactId !== contactId
      ) {
        return NextResponse.json(
          { error: "Charge does not belong to this contact" },
          { status: 400 },
        );
      }
      if (c.status === MemberChargeStatus.SETTLED) {
        return NextResponse.json(
          { error: "A charge is already settled" },
          { status: 400 },
        );
      }
      if (c.status === MemberChargeStatus.WRITTEN_OFF) {
        return NextResponse.json(
          { error: "A charge was written off and can't be settled" },
          { status: 400 },
        );
      }
    }
    if (new Set(charges.map((c) => c.direction)).size > 1) {
      return NextResponse.json(
        {
          error:
            "Mix of directions — settle 'they owe me' and 'I owe them' charges separately",
        },
        { status: 400 },
      );
    }
    const isIncoming = charges[0].direction !== MemberChargeDirection.USER_OWES;

    const byId = new Map(charges.map((c) => [c.id, c]));
    for (const line of data.lines) {
      const c = byId.get(line.chargeId)!;
      const remaining = Number(c.amount) - Number(c.settledAmount);
      if (line.amount > remaining + 0.005) {
        return NextResponse.json(
          {
            error: `A line exceeds what's outstanding on its charge (₹${remaining.toFixed(2)})`,
          },
          { status: 400 },
        );
      }
    }

    if (fundedFromAdvance) {
      // Their money sitting with us pays down what they owe us; our money
      // sitting with them pays down what we owe them. The CHECK >= 0 on the
      // counter is what actually settles a race here; this is the friendly
      // message for the ordinary case.
      const available = Number(
        isIncoming ? contact.advanceHeld : contact.advancePaid,
      );
      if (total > available + 0.005) {
        return NextResponse.json(
          { error: `Only ₹${available.toFixed(2)} of advance credit is available` },
          { status: 400 },
        );
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      // ── Advance-funded: no cash, draw the credit down instead ──────────
      if (fundedFromAdvance) {
        await tx.contact.update({
          where: { id: contactId },
          data: isIncoming
            ? { advanceHeld: { decrement: total } }
            : { advancePaid: { decrement: total } },
        });
      }

      // ── One Transaction for the ALLOCATED total, never the received ───
      let txnId: string | null = null;
      if (!fundedFromAdvance && (resolvedAccountId || resolvedCardId)) {
        const txn = await tx.transaction.create({
          data: {
            workspaceId: ctx.workspaceId,
            type: isIncoming ? TransactionType.INCOME : TransactionType.EXPENSE,
            amount: total,
            description:
              data.notes?.trim() ||
              `Bulk settlement · ${contact.name} (${data.lines.length} charge${
                data.lines.length === 1 ? "" : "s"
              })`,
            date: paidAt,
            accountId: resolvedAccountId,
            cardId: resolvedCardId,
            beneficiaryContactId: contactId,
            userId: ctx.userId,
            createdByUserId: ctx.userId,
          },
        });
        txnId = txn.id;
      }

      // All the settlement rows in one round-trip.
      await tx.memberChargeSettlement.createMany({
        data: data.lines.map((line) => ({
          chargeId: line.chargeId,
          amount: line.amount,
          paidAt,
          notes: data.notes,
          transactionId: txnId,
          fundedByAdvance: fundedFromAdvance,
        })),
      });

      // The increment has to be per row — it's the atomic step that stops
      // two concurrent settles from losing each other's writes, and the
      // CHECK constraint rejects whichever one would over-settle. Each
      // update hands back the value the database actually landed on, so the
      // status below is never derived from a stale read.
      const settledIds: string[] = [];
      const partialIds: string[] = [];
      for (const line of data.lines) {
        const updated = await tx.memberCharge.update({
          where: { id: line.chargeId },
          data: {
            settledAmount: { increment: line.amount },
            lastSettlementAt: paidAt,
          },
          select: { amount: true, settledAmount: true },
        });
        (Number(updated.settledAmount) >= Number(updated.amount) - 0.01
          ? settledIds
          : partialIds
        ).push(line.chargeId);
      }
      // Two round-trips for the statuses instead of one per line.
      if (settledIds.length > 0) {
        await tx.memberCharge.updateMany({
          where: { id: { in: settledIds } },
          data: { status: MemberChargeStatus.SETTLED },
        });
      }
      if (partialIds.length > 0) {
        await tx.memberCharge.updateMany({
          where: { id: { in: partialIds } },
          data: { status: MemberChargeStatus.PARTIAL },
        });
      }

      // ── The leftover ──────────────────────────────────────────────────
      let leftover: LeftoverResult | null = null;
      if (data.leftover && resolvedAccountId) {
        const kind = data.leftover.kind;
        const amount = leftoverAmount;
        const leftoverNotes = data.leftover.notes?.trim() || null;
        // Incoming settle → the surplus arrived with their payment, so the
        // leftover moves the same way the settlement did.
        const outgoing = !isIncoming;

        if (kind === "GIFT") {
          // Deliberately a plain EXPENSE / INCOME, not a Transfer: cashflow,
          // P&L and the dashboard all filter `transferId: null`, so a
          // gift-as-transfer would move the balance and show up nowhere.
          const description =
            leftoverNotes ??
            (outgoing ? `Gift to ${contact.name}` : `Gift from ${contact.name}`);
          const giftTxn = await tx.transaction.create({
            data: {
              workspaceId: ctx.workspaceId,
              type: outgoing ? TransactionType.EXPENSE : TransactionType.INCOME,
              amount,
              description,
              date: paidAt,
              accountId: resolvedAccountId,
              beneficiaryContactId: contactId,
              memberChargeType: MemberChargeType.GIFT,
              userId: ctx.userId,
              createdByUserId: ctx.userId,
            },
          });
          if (outgoing) {
            // Non-recoverable split so the contact's "spent on them" reader
            // picks it up. Only meaningful on the expense side — an incoming
            // gift is income, not a shared cost.
            await tx.transactionSplit.create({
              data: {
                workspaceId: ctx.workspaceId,
                transactionId: giftTxn.id,
                contactId,
                amount,
                isRecoverable: false,
                notes: leftoverNotes,
              },
            });
          }
          leftover = {
            amount,
            kind,
            transferId: null,
            transactionId: giftTxn.id,
            chargeId: null,
          };
        } else {
          // OBLIGATION and ADVANCE both move real cash between an account
          // and the contact, which is exactly what a Transfer records. They
          // differ only in what's left owing afterwards: an obligation is an
          // itemised debt, an advance is a running credit balance.
          const created = await createContactTransfer(tx, {
            workspaceId: ctx.workspaceId,
            userId: ctx.userId,
            contactId,
            contactName: contact.name,
            accountId: resolvedAccountId,
            amount,
            date: paidAt,
            notes:
              leftoverNotes ??
              (kind === "ADVANCE"
                ? `Advance credit · ${contact.name}`
                : outgoing
                  ? `Overpaid ${contact.name}`
                  : `${contact.name} overpaid`),
            outgoing,
            obligation: kind === "OBLIGATION",
            settlementTxnId: txnId,
          });
          if (kind === "ADVANCE") {
            await tx.contact.update({
              where: { id: contactId },
              data: outgoing
                ? { advancePaid: { increment: amount } }
                : { advanceHeld: { increment: amount } },
            });
          }
          leftover = {
            amount,
            kind,
            transferId: created.transferId,
            transactionId: created.transactionId,
            chargeId: created.memberChargeId,
          };
        }
      }

      return {
        transactionId: txnId,
        totalSettled: total,
        isIncoming,
        leftover,
      };
    },
    {
      // A settle is a handful of dependent writes — a batched settlement
      // insert, one atomic increment per charge, then the leftover's
      // transfer and obligation. Against a remote database each is a
      // round-trip, and Prisma's 5s default was blowing up on real
      // multi-charge settles. Everything that doesn't have to be in here
      // (the charge reads, the account lookups, the validation) already
      // runs before it opens.
      timeout: 15_000,
      maxWait: 10_000,
    });

    void sendPaymentConfirmationEmail({
      workspaceId: ctx.workspaceId,
      // Send only to the actor (the one who recorded the settlement) —
      // broadcasting to the workspace would over-notify and the
      // `members` permission gate would block regular MEMBERs anyway.
      recipientUserIds: [ctx.userId],
      kind: "SETTLEMENT",
      autopayed: false,
      amount: result.totalSettled,
      label: result.isIncoming
        ? `Received from ${contact.name}`
        : `Paid ${contact.name}`,
      sourceLabel: fundedFromAdvance
        ? "advance credit (no cash flow)"
        : resolvedCardId || resolvedAccountId
          ? resolvedCardId
            ? "Card"
            : "Account"
          : "audit-only (no cash flow)",
      link: `/contacts/${contactId}`,
    }).catch((e) => console.warn("[bulk-settle] email failed", e));

    return NextResponse.json({
      transactionId: result.transactionId,
      totalSettled: result.totalSettled,
      leftover: result.leftover,
    });
  } catch (e) {
    return err(e);
  }
}
