import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  requireWorkspace,
  WorkspaceAccessError,
  assertWorkspaceMembers,
  assertWorkspaceFamilyMember,
} from "@/lib/workspace";
import { canAccessRecord, canModifyRecord } from "@/lib/permissions";
import { auth } from "@/lib/auth";
import { cardUpdateSchema } from "@/lib/validators-domain";

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
        ownerMember: { select: { id: true, name: true } },
        account: { select: { id: true, creditLimit: true, statementDate: true, gracePeriod: true } },
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
    await assertWorkspaceFamilyMember(ctx.workspaceId, parsed.data.ownerMemberId);
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
        ownerMemberId: parsed.data.ownerMemberId ?? existing.ownerMemberId,
        sharedWithUserIds: parsed.data.sharedWithUserIds ?? existing.sharedWithUserIds,
        active: parsed.data.active ?? existing.active,
      },
    });
    // Propagate credit-limit updates to the companion Account — but a SHARED
    // sub-card has no own limit (the pool lives on its parent), so force null.
    if (existing.accountId) {
      const isSharedChild = nextLimitMode === "SHARED";
      if (isSharedChild) {
        await prisma.account.update({
          where: { id: existing.accountId },
          data: { creditLimit: null },
        });
      } else if (parsed.data.creditLimit !== undefined) {
        await prisma.account.update({
          where: { id: existing.accountId },
          data: {
            creditLimit: parsed.data.creditLimit ?? null,
            statementDate: parsed.data.statementDate ?? undefined,
            gracePeriod: parsed.data.gracePeriod ?? undefined,
          },
        });
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
