import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { visibilityFilter } from "@/lib/permissions";
import { auth } from "@/lib/auth";
import { cardCreateSchema } from "@/lib/validators-domain";
import { computeAccountBalance } from "@/lib/account-balance";

function error(err: unknown) {
  if (err instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error("[cards]", err);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

async function computeCardAvailableLimit(cardId: string, accountId: string | null, creditLimit: number | null) {
  if (creditLimit == null) return null;
  const [balance, emiAgg] = await Promise.all([
    accountId ? computeAccountBalance(accountId) : Promise.resolve(null),
    prisma.loan.aggregate({
      where: { cardId, source: "CARD_EMI", active: true },
      _sum: { outstanding: true },
    }),
  ]);
  const outstandingStatement = balance ? balance.balance : 0;
  const outstandingEmi = Number(emiAgg._sum.outstanding ?? 0);
  return creditLimit - outstandingEmi - Math.max(0, outstandingStatement);
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
        ownerMember: { select: { id: true, name: true } },
        account: { select: { id: true, creditLimit: true } },
        parentAccount: { select: { id: true, name: true } },
      },
    });

    const availableLimits = await Promise.all(
      cards.map((c) => {
        const cl = c.account?.creditLimit == null ? null : Number(c.account.creditLimit);
        return c.kind === "CREDIT"
          ? computeCardAvailableLimit(c.id, c.accountId, cl)
          : Promise.resolve(null);
      })
    );

    return NextResponse.json({
      cards: cards.map((c, i) => ({
        id: c.id,
        name: c.name,
        kind: c.kind,
        network: c.network,
        supportsUpi: c.supportsUpi,
        last4: c.last4,
        limitMode: c.limitMode,
        active: c.active,
        ownerUser: c.ownerUser,
        ownerMember: c.ownerMember,
        parentAccount: c.parentAccount,
        accountId: c.accountId,
        creditLimit: c.account?.creditLimit == null ? null : Number(c.account.creditLimit),
        availableLimit: availableLimits[i],
        sharedWithUserIds: c.sharedWithUserIds,
      })),
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
    // For a CREDIT card we also create a companion Account (kind=CARD) to track
    // its outstanding balance and statements. For DEBIT cards, the user must
    // pick an existing BANK account to link (parentAccountId).
    const result = await prisma.$transaction(async (tx) => {
      let companionAccountId: string | null = parsed.data.accountId ?? null;
      if (parsed.data.kind === "CREDIT" && !companionAccountId) {
        const companion = await tx.account.create({
          data: {
            workspaceId: ctx.workspaceId,
            kind: "CARD",
            name: parsed.data.name,
            openingBalance: 0,
            creditLimit: parsed.data.creditLimit ?? null,
            statementDate: parsed.data.statementDate ?? null,
            gracePeriod: parsed.data.gracePeriod ?? null,
            ownerUserId: parsed.data.ownerUserId ?? ctx.userId,
            ownerMemberId: parsed.data.ownerMemberId ?? null,
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
          accountId: companionAccountId,
          limitMode: parsed.data.limitMode ?? "SOLO",
          ownerUserId: parsed.data.ownerUserId ?? ctx.userId,
          ownerMemberId: parsed.data.ownerMemberId ?? null,
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
