import { prisma } from "@/lib/prisma";
import { computeAccountBalance } from "@/lib/account-balance";

type PoolInputs = {
  poolCardIds: string[];
  poolAccountIds: string[];
  creditLimit: number | null;
};

/** Aggregate outstanding statement balances + active EMI principals across a pool. */
export async function computeAvailableLimitForPool({
  poolCardIds,
  poolAccountIds,
  creditLimit,
}: PoolInputs): Promise<number | null> {
  if (creditLimit == null) return null;
  const [balances, emiAgg] = await Promise.all([
    Promise.all(poolAccountIds.map((id) => computeAccountBalance(id))),
    prisma.loan.aggregate({
      where: { cardId: { in: poolCardIds }, source: "CARD_EMI", active: true },
      _sum: { outstanding: true },
    }),
  ]);
  const outstandingStatement = balances.reduce((s, b) => s + Math.max(0, b.balance), 0);
  const outstandingEmi = Number(emiAgg._sum.outstanding ?? 0);
  return creditLimit - outstandingEmi - outstandingStatement;
}

/**
 * Available limit for a single CARD-kind Account (looked up by accountId).
 * Walks parentCard / childCards so SHARED sub-cards inherit their parent's
 * pool. Returns null if the account isn't linked to a Card or the card has
 * no creditLimit set.
 */
export async function computeAccountAvailableLimit(
  accountId: string,
): Promise<number | null> {
  const card = await prisma.card.findUnique({
    where: { accountId },
    include: {
      account: { select: { creditLimit: true } },
      parentCard: {
        select: {
          id: true,
          accountId: true,
          account: { select: { creditLimit: true } },
        },
      },
      childCards: { select: { id: true, accountId: true } },
    },
  });
  if (!card || card.kind !== "CREDIT") return null;

  const isSharedChild = card.limitMode === "SHARED" && card.parentCard;
  const limitSource = isSharedChild
    ? card.parentCard?.account?.creditLimit
    : card.account?.creditLimit;
  if (limitSource == null) return null;

  const poolCardIds: string[] = [];
  const poolAccountIds: string[] = [];
  if (isSharedChild && card.parentCard) {
    poolCardIds.push(card.parentCard.id, card.id);
    if (card.parentCard.accountId) poolAccountIds.push(card.parentCard.accountId);
    if (card.accountId) poolAccountIds.push(card.accountId);
    const siblings = await prisma.card.findMany({
      where: { parentCardId: card.parentCard.id, NOT: { id: card.id } },
      select: { id: true, accountId: true },
    });
    for (const s of siblings) {
      poolCardIds.push(s.id);
      if (s.accountId) poolAccountIds.push(s.accountId);
    }
  } else {
    poolCardIds.push(card.id);
    if (card.accountId) poolAccountIds.push(card.accountId);
    for (const ch of card.childCards) {
      poolCardIds.push(ch.id);
      if (ch.accountId) poolAccountIds.push(ch.accountId);
    }
  }

  return computeAvailableLimitForPool({
    poolCardIds,
    poolAccountIds,
    creditLimit: Number(limitSource),
  });
}
