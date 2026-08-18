import { prisma } from "@/lib/prisma";
import { canAccessRecord } from "@/lib/permissions";
import { computeOrnamentLine, type OrnamentLine } from "@/lib/gold";
import type { Prisma } from "@/generated/prisma/client";
import type { GoldOrnamentInput } from "@/lib/validators-domain";

/** The session shape permissions.ts accepts; not exported from there. */
type SessionArg = Parameters<typeof canAccessRecord>[0];

/**
 * Pieces shared by every gold route. Kept out of the route files so the
 * create and update paths can't drift apart on the two things that must
 * never drift: how a line total is verified, and which funding sources
 * the caller is allowed to spend from.
 */

export type GoldRouteError = { status: number; message: string };

/** Shape the validator produces for one ornament, derived from it. */
export type OrnamentInput = GoldOrnamentInput;

/**
 * Recompute every line server-side and refuse the ones that disagree
 * with what the client claimed. The tolerance is one paise — enough to
 * absorb float noise, far too tight to hide a tampered or stale figure.
 */
export function computeLines(
  ornaments: OrnamentInput[],
): { lines: OrnamentLine[] } | { error: GoldRouteError } {
  const lines: OrnamentLine[] = [];
  for (const o of ornaments) {
    const line = computeOrnamentLine(o);
    if (Math.abs(line.lineTotal - o.lineTotal) > 0.01) {
      return {
        error: {
          status: 400,
          message:
            `"${o.name}" adds up to ₹${line.lineTotal.toFixed(2)}, but the ` +
            `form sent ₹${o.lineTotal.toFixed(2)}. Reopen the ornament and ` +
            `check its weight, rate and charges.`,
        },
      };
    }
    lines.push(line);
  }
  return { lines };
}

/**
 * Cost basis rule, in one place because three different routes need the
 * same answer. A piece bought for someone else is not the workspace's
 * asset (its money is the receivable); a gift cost nothing, so it adds
 * real grams and ₹0 to "Invested"; opening stock carries whatever the
 * user says they paid, years ago.
 */
export function costBasisFor(
  kind: "PURCHASE" | "GIFT_RECEIVED" | "OPENING_STOCK",
  ornament: { boughtForContactId?: string | null; openingCostBasis?: number | null },
  lineTotal: number,
): number {
  if (ornament.boughtForContactId) return 0;
  if (kind === "GIFT_RECEIVED") return 0;
  if (kind === "OPENING_STOCK") return ornament.openingCostBasis ?? 0;
  return lineTotal;
}

/**
 * Verify every account / card the request wants to spend from belongs to
 * this workspace and the caller can access it, up-front, before anything
 * is written. Returns the cardId→companion-account map so card spends
 * land on the card's own ledger — without it the card's outstanding
 * never moves and `availableLimit` goes stale, the same routing
 * /api/transactions does.
 */
export async function loadFundingSources(
  session: SessionArg,
  workspaceId: string,
  accountIds: string[],
  cardIds: string[],
): Promise<
  { cardIdToAccountId: Map<string, string | null> } | { error: GoldRouteError }
> {
  const uniqueAccounts = [...new Set(accountIds)];
  const uniqueCards = [...new Set(cardIds)];
  const cardIdToAccountId = new Map<string, string | null>();
  if (!uniqueAccounts.length && !uniqueCards.length) {
    return { cardIdToAccountId };
  }

  const [accs, cards] = await Promise.all([
    uniqueAccounts.length
      ? prisma.account.findMany({ where: { id: { in: uniqueAccounts } } })
      : Promise.resolve([]),
    uniqueCards.length
      ? prisma.card.findMany({ where: { id: { in: uniqueCards } } })
      : Promise.resolve([]),
  ]);

  if (accs.length !== uniqueAccounts.length || cards.length !== uniqueCards.length) {
    return { error: { status: 404, message: "Payment source not found" } };
  }
  for (const a of accs) {
    if (a.workspaceId !== workspaceId || !canAccessRecord(session, a)) {
      return { error: { status: 403, message: "Forbidden" } };
    }
  }
  for (const c of cards) {
    if (c.workspaceId !== workspaceId || !canAccessRecord(session, c)) {
      return { error: { status: 403, message: "Forbidden" } };
    }
    cardIdToAccountId.set(c.id, c.accountId);
  }
  return { cardIdToAccountId };
}

/**
 * The two seeded categories gold money moves through. Both are optional —
 * a workspace that lost its defaults still gets working transactions,
 * just uncategorised. Same fallback the vehicle-disposal route uses.
 */
export async function resolveGoldCategories(workspaceId: string): Promise<{
  expenseCategoryId: string | null;
  saleCategoryId: string | null;
}> {
  const [expense, sale] = await Promise.all([
    prisma.category.findFirst({
      where: {
        name: "Gold/Jewellery",
        OR: [{ workspaceId }, { workspaceId: null, isDefault: true }],
        types: { has: "EXPENSE" },
      },
      select: { id: true },
    }),
    prisma.category.findFirst({
      where: {
        name: "Gold/Jewellery sale",
        OR: [{ workspaceId }, { workspaceId: null, isDefault: true }],
        types: { has: "INCOME" },
      },
      select: { id: true },
    }),
  ]);
  return {
    expenseCategoryId: expense?.id ?? null,
    saleCategoryId: sale?.id ?? null,
  };
}

/**
 * Refuse to disturb an ornament whose receivable is already part-paid.
 * Rewriting the line would leave the contact's settled money pointing at
 * a charge that no longer describes what they bought, so the user has to
 * reverse the settlement first — deliberately their call, not ours.
 */
export function blockingSettledCharge(
  ornaments: Array<{
    name: string;
    boughtForContact?: { name: string } | null;
    memberCharge?: {
      settledAmount: unknown;
      status: string;
    } | null;
  }>,
): GoldRouteError | null {
  for (const o of ornaments) {
    const mc = o.memberCharge;
    if (!mc) continue;
    const settled = Number(mc.settledAmount);
    if (settled > 0 || mc.status !== "OUTSTANDING") {
      const who = o.boughtForContact?.name ?? "That contact";
      return {
        status: 409,
        message:
          `${who} has already paid ₹${settled.toFixed(2)} toward "${o.name}". ` +
          `Reverse that settlement before editing or deleting this bill.`,
      };
    }
  }
  return null;
}

/* ------------------------ Read-side serialisation ------------------------ */

/** Relations every ornament read needs. Shared so list and detail agree. */
export const ornamentInclude = {
  assignedContact: { select: { id: true, name: true } },
  boughtForContact: { select: { id: true, name: true } },
  disposalContact: { select: { id: true, name: true } },
  memberCharge: {
    select: {
      id: true,
      amount: true,
      settledAmount: true,
      status: true,
    },
  },
} as const;

export function serializeOrnament(o: {
  id: string;
  name: string;
  itemType: string | null;
  quantity: number;
  purity: string | null;
  grossWeightGrams: Prisma.Decimal;
  stoneWeightGrams: Prisma.Decimal;
  netWeightGrams: Prisma.Decimal;
  ratePerGram: Prisma.Decimal;
  wastageAmount: Prisma.Decimal;
  wastageInput: string | null;
  wastageMode: string | null;
  makingAmount: Prisma.Decimal;
  makingInput: string | null;
  makingMode: string | null;
  stones: Prisma.JsonValue;
  cgstAmount: Prisma.Decimal;
  cgstInput: string | null;
  cgstMode: string | null;
  sgstAmount: Prisma.Decimal;
  sgstInput: string | null;
  sgstMode: string | null;
  roundOff: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
  costBasis: Prisma.Decimal;
  declaredValue: Prisma.Decimal | null;
  status: string;
  disposedAt: Date | null;
  disposalKind: string | null;
  disposalAmount: Prisma.Decimal | null;
  realisedGain: Prisma.Decimal | null;
  notes: string | null;
  sortOrder: number;
  assignedContact?: { id: string; name: string } | null;
  boughtForContact?: { id: string; name: string } | null;
  disposalContact?: { id: string; name: string } | null;
  memberCharge?: {
    id: string;
    amount: Prisma.Decimal;
    settledAmount: Prisma.Decimal;
    status: string;
  } | null;
}) {
  return {
    id: o.id,
    name: o.name,
    itemType: o.itemType,
    quantity: o.quantity,
    purity: o.purity,
    grossWeightGrams: Number(o.grossWeightGrams),
    stoneWeightGrams: Number(o.stoneWeightGrams),
    netWeightGrams: Number(o.netWeightGrams),
    ratePerGram: Number(o.ratePerGram),
    wastageAmount: Number(o.wastageAmount),
    wastageInput: o.wastageInput,
    wastageMode: o.wastageMode,
    makingAmount: Number(o.makingAmount),
    makingInput: o.makingInput,
    makingMode: o.makingMode,
    stones: o.stones ?? null,
    cgstAmount: Number(o.cgstAmount),
    cgstInput: o.cgstInput,
    cgstMode: o.cgstMode,
    sgstAmount: Number(o.sgstAmount),
    sgstInput: o.sgstInput,
    sgstMode: o.sgstMode,
    roundOff: Number(o.roundOff),
    lineTotal: Number(o.lineTotal),
    costBasis: Number(o.costBasis),
    declaredValue: o.declaredValue == null ? null : Number(o.declaredValue),
    status: o.status,
    disposedAt: o.disposedAt?.toISOString() ?? null,
    disposalKind: o.disposalKind,
    disposalAmount:
      o.disposalAmount == null ? null : Number(o.disposalAmount),
    realisedGain: o.realisedGain == null ? null : Number(o.realisedGain),
    notes: o.notes,
    sortOrder: o.sortOrder,
    assignedContact: o.assignedContact ?? null,
    boughtForContact: o.boughtForContact ?? null,
    disposalContact: o.disposalContact ?? null,
    memberCharge: o.memberCharge
      ? {
          id: o.memberCharge.id,
          amount: Number(o.memberCharge.amount),
          settledAmount: Number(o.memberCharge.settledAmount),
          status: o.memberCharge.status,
        }
      : null,
  };
}
