import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { canAccessRecord } from "@/lib/permissions";
import { contactBulkSettleSchema } from "@/lib/validators-domain";
import { sendPaymentConfirmationEmail } from "@/lib/notifications-payment";
import {
  MemberChargeDirection,
  MemberChargeStatus,
  TransactionType,
} from "@/generated/prisma/client";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[contact-bulk-settle]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

/**
 * Bulk-settle multiple outstanding charges belonging to a single
 * contact in a single round-trip. All charges must share the same
 * direction (OWED_TO_USER or USER_OWES) so a single cash flow makes
 * sense. Lines can partially settle a charge; the cumulative
 * `settledAmount` advances each charge to PARTIAL / SETTLED.
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

    // Pull every charge in one go; reject if any belongs to a different
    // workspace or contact, OR if they mix directions.
    const chargeIds = data.lines.map((l) => l.chargeId);
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
          { error: `Charge ${c.id} is already settled` },
          { status: 400 },
        );
      }
    }
    const directions = new Set(charges.map((c) => c.direction));
    if (directions.size > 1) {
      return NextResponse.json(
        {
          error:
            "Mix of directions — settle 'they owe me' and 'I owe them' charges separately",
        },
        { status: 400 },
      );
    }
    const direction = charges[0].direction;
    const isIncoming = direction !== MemberChargeDirection.USER_OWES;

    // Per-line cap: amount must be positive AND must not exceed
    // remaining on its charge. (The Zod schema already enforces
    // positive at the type level via `.positive()`, but defensive
    // validation guards against future schema relaxation.)
    const byId = new Map(charges.map((c) => [c.id, c]));
    let total = 0;
    for (const line of data.lines) {
      if (line.amount <= 0) {
        return NextResponse.json(
          { error: "Settlement amount must be positive" },
          { status: 400 },
        );
      }
      const c = byId.get(line.chargeId)!;
      const remaining = Number(c.amount) - Number(c.settledAmount);
      if (line.amount > remaining + 0.005) {
        return NextResponse.json(
          {
            error: `Line for ${c.id} exceeds outstanding (₹${remaining.toFixed(
              2,
            )})`,
          },
          { status: 400 },
        );
      }
      total += line.amount;
    }
    total = Math.round(total * 100) / 100;

    // Resolve the cash-flow side. accountId/cardId is required when the
    // user expects a transaction; if neither is supplied we still record
    // settlements but skip the txn (audit-only).
    let resolvedAccountId: string | null = data.accountId ?? null;
    const resolvedCardId: string | null = data.cardId ?? null;
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

    const paidAt = new Date(data.paidAt);
    if (Number.isNaN(paidAt.getTime())) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      // One Transaction covers the entire bulk cash flow.
      let txnId: string | null = null;
      if (resolvedAccountId || resolvedCardId) {
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

      // One settlement row per line; update the charge's running total.
      for (const line of data.lines) {
        const c = byId.get(line.chargeId)!;
        const newSettled = Number(c.settledAmount) + line.amount;
        const newStatus =
          newSettled >= Number(c.amount) - 0.01
            ? MemberChargeStatus.SETTLED
            : MemberChargeStatus.PARTIAL;
        await tx.memberChargeSettlement.create({
          data: {
            chargeId: line.chargeId,
            amount: line.amount,
            paidAt,
            notes: data.notes,
            transactionId: txnId,
          },
        });
        await tx.memberCharge.update({
          where: { id: line.chargeId },
          data: {
            settledAmount: newSettled,
            status: newStatus,
            lastSettlementAt: paidAt,
          },
        });
      }
      return { transactionId: txnId, totalSettled: total };
    });

    void sendPaymentConfirmationEmail({
      workspaceId: ctx.workspaceId,
      // Send only to the actor (the one who recorded the settlement) —
      // broadcasting to the workspace would over-notify and the
      // `members` permission gate would block regular MEMBERs anyway.
      recipientUserIds: [ctx.userId],
      kind: "SETTLEMENT",
      autopayed: false,
      amount: total,
      label: isIncoming
        ? `Received from ${contact.name}`
        : `Paid ${contact.name}`,
      sourceLabel:
        resolvedCardId || resolvedAccountId
          ? resolvedCardId ? "Card" : "Account"
          : "audit-only (no cash flow)",
      link: `/contacts/${contactId}`,
    }).catch((e) => console.warn("[bulk-settle] email failed", e));

    return NextResponse.json(result);
  } catch (e) {
    return err(e);
  }
}
