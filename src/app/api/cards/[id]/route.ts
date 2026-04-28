import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  requireWorkspace,
  WorkspaceAccessError,
  assertWorkspaceMembers,
  assertWorkspaceContact,
} from "@/lib/workspace";
import { canAccessRecord, canModifyRecord } from "@/lib/permissions";
import { auth } from "@/lib/auth";
import { cardUpdateSchema } from "@/lib/validators-domain";
import { nextStatementDueDate } from "@/lib/statement-period";

function error(err: unknown) {
  if (err instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireWorkspace("cards", "read");
    const session = await auth();
    const { id } = await context.params;
    const card = await prisma.card.findUnique({
      where: { id },
      include: {
        ownerUser: { select: { id: true, name: true } },
        ownerContact: { select: { id: true, name: true } },
        account: { select: { id: true, creditLimit: true, statementDate: true, gracePeriod: true, nextBillDue: true, nextBillAmount: true } },
        parentAccount: { select: { id: true, name: true } },
      },
    });
    if (!card || card.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!canAccessRecord(session, card)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ card });
  } catch (err) {
    return error(err);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireWorkspace("cards", "write");
    const session = await auth();
    const { id } = await context.params;
    const body = await request.json();
    const parsed = cardUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const existing = await prisma.card.findUnique({ where: { id } });
    if (!existing || existing.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!canModifyRecord(session, existing)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    await assertWorkspaceMembers(ctx.workspaceId, [
      parsed.data.ownerUserId,
      ...(parsed.data.sharedWithUserIds ?? []),
    ]);
    await assertWorkspaceContact(ctx.workspaceId, parsed.data.ownerContactId);
    const nextLimitMode = parsed.data.limitMode ?? existing.limitMode;
    const nextParentCardId =
      parsed.data.parentCardId !== undefined ? parsed.data.parentCardId : existing.parentCardId;
    if (nextLimitMode === "SHARED" && !nextParentCardId) {
      return NextResponse.json(
        { error: "Pick a parent card for a shared sub-card." },
        { status: 400 },
      );
    }
    if (nextParentCardId) {
      if (nextParentCardId === id) {
        return NextResponse.json({ error: "A card can't be its own parent." }, { status: 400 });
      }
      const parent = await prisma.card.findUnique({
        where: { id: nextParentCardId },
        select: { workspaceId: true, kind: true },
      });
      if (!parent || parent.workspaceId !== ctx.workspaceId || parent.kind !== "CREDIT") {
        return NextResponse.json({ error: "Invalid parent card." }, { status: 400 });
      }
    }
    const card = await prisma.card.update({
      where: { id },
      data: {
        name: parsed.data.name ?? existing.name,
        kind: parsed.data.kind ?? existing.kind,
        network: parsed.data.network ?? existing.network,
        supportsUpi: parsed.data.supportsUpi ?? existing.supportsUpi,
        last4: parsed.data.last4 ?? existing.last4,
        parentAccountId: parsed.data.parentAccountId ?? existing.parentAccountId,
        parentCardId: nextLimitMode === "SHARED" ? nextParentCardId : null,
        limitMode: nextLimitMode,
        ownerUserId: parsed.data.ownerUserId ?? existing.ownerUserId,
        ownerContactId: parsed.data.ownerContactId ?? existing.ownerContactId,
        sharedWithUserIds: parsed.data.sharedWithUserIds ?? existing.sharedWithUserIds,
        active: parsed.data.active ?? existing.active,
      },
    });
    // Propagate credit-limit / billing-cycle updates to the companion
    // Account. A SHARED sub-card has no own limit (the pool lives on its
    // parent), so force null there — but statementDate / gracePeriod still
    // belong on its own account so card EMI math works per sub-card.
    if (existing.accountId) {
      const isSharedChild = nextLimitMode === "SHARED";
      const accountPatch: {
        creditLimit?: number | null;
        statementDate?: number | null;
        gracePeriod?: number | null;
        nextBillDue?: Date | null;
        nextBillAmount?: number | null;
      } = {};
      if (isSharedChild) {
        accountPatch.creditLimit = null;
      } else if (parsed.data.creditLimit !== undefined) {
        accountPatch.creditLimit = parsed.data.creditLimit ?? null;
      }
      if (parsed.data.statementDate !== undefined) {
        accountPatch.statementDate = parsed.data.statementDate ?? null;
      }
      if (parsed.data.gracePeriod !== undefined) {
        accountPatch.gracePeriod = parsed.data.gracePeriod ?? null;
      }
      if (parsed.data.nextBillDue !== undefined) {
        accountPatch.nextBillDue = parsed.data.nextBillDue
          ? new Date(parsed.data.nextBillDue)
          : null;
      }
      if (parsed.data.nextBillAmount !== undefined) {
        accountPatch.nextBillAmount = parsed.data.nextBillAmount ?? null;
      }
      if (Object.keys(accountPatch).length > 0) {
        await prisma.account.update({
          where: { id: existing.accountId },
          data: accountPatch,
        });
      }
    }

    // Cascade statementDate / gracePeriod changes to any active
    // CREDIT_CARD_LOAN loans linked to this card so their stored
    // nextDueDate reflects the new billing cycle. Otherwise the loan would
    // keep showing the old (now stale) due date until the next payment.
    const sdChanged = parsed.data.statementDate !== undefined;
    const graceChanged = parsed.data.gracePeriod !== undefined;
    if ((sdChanged || graceChanged) && existing.accountId) {
      const refreshed = await prisma.account.findUnique({
        where: { id: existing.accountId },
        select: { statementDate: true, gracePeriod: true },
      });
      if (refreshed?.statementDate != null) {
        const linkedLoans = await prisma.loan.findMany({
          where: { cardId: id, kind: "CREDIT_CARD_LOAN", active: true },
          select: {
            id: true,
            outstanding: true,
            loanStatementDate: true,
            loanGracePeriod: true,
          },
        });
        for (const l of linkedLoans) {
          if (Number(l.outstanding) <= 0) continue;
          // Per-loan override wins; only loans using the card's defaults
          // need their nextDueDate refreshed when the card cycle changes.
          const sd = l.loanStatementDate ?? refreshed.statementDate;
          const grace = l.loanGracePeriod ?? refreshed.gracePeriod ?? 0;
          const nextDue = nextStatementDueDate(new Date(), sd, grace);
          await prisma.loan.update({
            where: { id: l.id },
            data: { nextDueDate: nextDue },
          });
        }
      }
    }
    return NextResponse.json({ id: card.id });
  } catch (err) {
    return error(err);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireWorkspace("cards", "write");
    const session = await auth();
    const { id } = await context.params;
    const existing = await prisma.card.findUnique({ where: { id } });
    if (!existing || existing.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!canModifyRecord(session, existing)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const txCount = await prisma.transaction.count({ where: { cardId: id } });
    if (txCount > 0) {
      return NextResponse.json(
        { error: "Card has transactions — archive it instead of deleting." },
        { status: 400 }
      );
    }
    await prisma.$transaction(async (tx) => {
      await tx.card.delete({ where: { id } });
      if (existing.accountId) {
        // Drop the companion Account if it has no transactions either.
        const linkedTxCount = await tx.transaction.count({
          where: { accountId: existing.accountId },
        });
        if (linkedTxCount === 0) {
          await tx.account.delete({ where: { id: existing.accountId } }).catch(() => {});
        }
      }
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return error(err);
  }
}
