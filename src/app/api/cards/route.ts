import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  requireWorkspace,
  WorkspaceAccessError,
  assertWorkspaceMembers,
  assertWorkspaceContact,
} from "@/lib/workspace";
import { visibilityFilter } from "@/lib/permissions";
import { auth } from "@/lib/auth";
import { cardCreateSchema } from "@/lib/validators-domain";
import { computeAvailableLimitForPool } from "@/lib/card-available-limit";
import { computeAccountBalance } from "@/lib/account-balance";

function error(err: unknown) {
  if (err instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error("[cards]", err);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function GET() {
  try {
    const ctx = await requireWorkspace("cards", "read");
    const session = await auth();
    const cards = await prisma.card.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        ...visibilityFilter(session, ctx.ownOnly),
      },
      orderBy: [{ active: "desc" }, { name: "asc" }],
      include: {
        ownerUser: { select: { id: true, name: true } },
        ownerContact: { select: { id: true, name: true } },
        account: {
          select: {
            id: true,
            creditLimit: true,
            statementDate: true,
            gracePeriod: true,
            nextBillDue: true,
            nextBillAmount: true,
          },
        },
        parentAccount: { select: { id: true, name: true } },
        parentCard: {
          select: {
            id: true,
            name: true,
            accountId: true,
            account: { select: { creditLimit: true } },
          },
        },
        childCards: { select: { id: true, accountId: true } },
      },
    });

    const [availableLimits, debitBalances, creditBalances, upcomingBills] = await Promise.all([
      Promise.all(
        cards.map((c) => {
          if (c.kind !== "CREDIT") return Promise.resolve(null);
          const isSharedChild = c.limitMode === "SHARED" && c.parentCard;
          const limitSource = isSharedChild
            ? c.parentCard?.account?.creditLimit
            : c.account?.creditLimit;
          const cl = limitSource == null ? null : Number(limitSource);
          // Pool members: for a sub-card, parent + all siblings; for a parent
          // with SHARED children, self + children; otherwise just self.
          const poolCardIds: string[] = [];
          const poolAccountIds: string[] = [];
          if (isSharedChild && c.parentCard) {
            poolCardIds.push(c.parentCard.id, c.id);
            if (c.parentCard.accountId) poolAccountIds.push(c.parentCard.accountId);
            if (c.accountId) poolAccountIds.push(c.accountId);
          } else {
            poolCardIds.push(c.id);
            if (c.accountId) poolAccountIds.push(c.accountId);
            for (const ch of c.childCards) {
              poolCardIds.push(ch.id);
              if (ch.accountId) poolAccountIds.push(ch.accountId);
            }
          }
          return computeAvailableLimitForPool({ poolCardIds, poolAccountIds, creditLimit: cl });
        }),
      ),
      // For DEBIT cards: show the linked bank's spendable balance on the
      // list page so users see how much they can swipe.
      Promise.all(
        cards.map((c) =>
          c.kind === "DEBIT" && c.parentAccountId
            ? computeAccountBalance(c.parentAccountId).then((b) => b.balance)
            : Promise.resolve(null),
        ),
      ),
      // For CREDIT cards: raw companion-account balance = current statement
      // outstanding (excluding active EMI principals). Used by the loan
      // form to show "this card already has ₹X due" when picking it for a
      // CREDIT_CARD_LOAN, so users see what they're stacking the loan on.
      Promise.all(
        cards.map((c) =>
          c.kind === "CREDIT" && c.accountId
            ? computeAccountBalance(c.accountId).then((b) => b.balance)
            : Promise.resolve(null),
        ),
      ),
      // For CREDIT cards: the upcoming bill amount the user owes next.
      // Resolution order matches the card-detail page: manual override
      // (Account.nextBillAmount) wins, otherwise the oldest unpaid
      // CardStatement's outstanding (totalDue − tagged payments). Cards
      // with no statement materialised yet and no manual override return
      // null — they roll up as 0 in the page summary, which is correct
      // for the "you owe nothing yet" case.
      Promise.all(
        cards.map(async (c) => {
          if (c.kind !== "CREDIT" || !c.accountId) return null;
          if (c.account?.nextBillAmount != null) {
            return Number(c.account.nextBillAmount);
          }
          const unpaid = await prisma.cardStatement.findFirst({
            where: { accountId: c.accountId, paidAt: null },
            orderBy: { dueDate: "asc" },
            select: {
              totalDue: true,
              payments: { select: { amount: true } },
            },
          });
          if (!unpaid) return null;
          const paid = unpaid.payments.reduce(
            (s, p) => s + Number(p.amount),
            0,
          );
          return Math.max(0, Number(unpaid.totalDue) - paid);
        }),
      ),
    ]);

    return NextResponse.json({
      cards: cards.map((c, i) => {
        const isSharedChild = c.limitMode === "SHARED" && c.parentCard;
        const effectiveLimit = isSharedChild
          ? c.parentCard?.account?.creditLimit
          : c.account?.creditLimit;
        return {
          id: c.id,
          name: c.name,
          kind: c.kind,
          network: c.network,
          supportsUpi: c.supportsUpi,
          last4: c.last4,
          limitMode: c.limitMode,
          active: c.active,
          ownerUser: c.ownerUser,
          ownerContact: c.ownerContact,
          parentAccount: c.parentAccount,
          parentCard: c.parentCard
            ? { id: c.parentCard.id, name: c.parentCard.name }
            : null,
          accountId: c.accountId,
          creditLimit: effectiveLimit == null ? null : Number(effectiveLimit),
          statementDate: c.account?.statementDate ?? null,
          gracePeriod: c.account?.gracePeriod ?? null,
          nextBillDue: c.account?.nextBillDue?.toISOString() ?? null,
          nextBillAmount:
            c.account?.nextBillAmount != null
              ? Number(c.account.nextBillAmount)
              : null,
          availableLimit: availableLimits[i],
          linkedBalance: debitBalances[i],
          currentBalance: creditBalances[i],
          upcomingBillAmount: upcomingBills[i],
          sharedWithUserIds: c.sharedWithUserIds,
        };
      }),
    });
  } catch (err) {
    return error(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireWorkspace("cards", "write");
    const body = await request.json();
    const parsed = cardCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    await assertWorkspaceMembers(ctx.workspaceId, [
      parsed.data.ownerUserId,
      ...(parsed.data.sharedWithUserIds ?? []),
    ]);
    await assertWorkspaceContact(ctx.workspaceId, parsed.data.ownerContactId);
    // For a CREDIT card we also create a companion Account (kind=CARD) to track
    // statement spend. SHARED sub-cards still get their own companion (because
    // accountId is unique on Card) but with creditLimit=null — the pool limit
    // lives on the parent's companion account.
    const isSharedChild =
      parsed.data.kind === "CREDIT" &&
      parsed.data.limitMode === "SHARED" &&
      !!parsed.data.parentCardId;
    if (parsed.data.kind === "CREDIT" && parsed.data.limitMode === "SHARED" && !parsed.data.parentCardId) {
      return NextResponse.json(
        { error: "Pick a parent card for a shared sub-card." },
        { status: 400 },
      );
    }
    if (parsed.data.parentCardId) {
      const parent = await prisma.card.findUnique({
        where: { id: parsed.data.parentCardId },
        select: { workspaceId: true, kind: true },
      });
      if (!parent || parent.workspaceId !== ctx.workspaceId || parent.kind !== "CREDIT") {
        return NextResponse.json({ error: "Invalid parent card." }, { status: 400 });
      }
    }
    const result = await prisma.$transaction(async (tx) => {
      let companionAccountId: string | null = parsed.data.accountId ?? null;
      if (parsed.data.kind === "CREDIT" && !companionAccountId) {
        // Each card (SOLO or SHARED sub-card) gets its own companion Account
        // and tracks its own balance. For SHARED, the pool math sums parent
        // + children, so seeding an existing outstanding here is correct.
        const companion = await tx.account.create({
          data: {
            workspaceId: ctx.workspaceId,
            kind: "CARD",
            name: parsed.data.name,
            openingBalance: parsed.data.openingBalance ?? 0,
            creditLimit: isSharedChild ? null : parsed.data.creditLimit ?? null,
            statementDate: parsed.data.statementDate ?? null,
            gracePeriod: parsed.data.gracePeriod ?? null,
            nextBillDue: parsed.data.nextBillDue
              ? new Date(parsed.data.nextBillDue)
              : null,
            nextBillAmount: parsed.data.nextBillAmount ?? null,
            ownerUserId: parsed.data.ownerUserId ?? ctx.userId,
            ownerContactId: parsed.data.ownerContactId ?? null,
            sharedWithUserIds: parsed.data.sharedWithUserIds ?? [],
          },
        });
        companionAccountId = companion.id;
      }
      const card = await tx.card.create({
        data: {
          workspaceId: ctx.workspaceId,
          name: parsed.data.name,
          kind: parsed.data.kind,
          network: parsed.data.network ?? "OTHER",
          supportsUpi: parsed.data.supportsUpi ?? false,
          last4: parsed.data.last4 ?? null,
          parentAccountId: parsed.data.parentAccountId ?? null,
          parentCardId: isSharedChild ? parsed.data.parentCardId! : null,
          accountId: companionAccountId,
          limitMode: parsed.data.limitMode ?? "SOLO",
          ownerUserId: parsed.data.ownerUserId ?? ctx.userId,
          ownerContactId: parsed.data.ownerContactId ?? null,
          sharedWithUserIds: parsed.data.sharedWithUserIds ?? [],
        },
      });
      return card;
    });
    return NextResponse.json({ id: result.id });
  } catch (err) {
    return error(err);
  }
}
