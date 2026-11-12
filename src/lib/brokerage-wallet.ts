/**
 * Brokerage wallets — the server half: the guards every route that moves
 * money through a wallet, or links a holding to one, runs first. The model
 * itself is described in `brokerage.ts`.
 *
 * Kept in one place because three routes post against a wallet
 * (/api/investments, /api/transactions, /api/transfers) and they have to
 * agree on the two things a wallet gets wrong silently: which account a
 * linked holding may trade through, and what a row is worth in the wallet's
 * own currency.
 */

import type { Session } from "next-auth";
import { prisma } from "@/lib/prisma";
import { canAccessRecord } from "@/lib/permissions";
import { computeAccountBalance } from "@/lib/account-balance";
import {
  formatMoney,
  isBrokerageHoldingKind,
  isForeignWallet,
  round2,
} from "@/lib/brokerage";

/** A rule violation the route should hand straight back to the user. */
export class BrokerageError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export type BrokerageAccount = {
  id: string;
  name: string;
  kind: string;
  currency: string;
  workspaceId: string;
  ownerUserId: string | null;
  sharedWithUserIds: string[];
};

const BROKERAGE_SELECT = {
  id: true,
  name: true,
  kind: true,
  currency: true,
  workspaceId: true,
  ownerUserId: true,
  sharedWithUserIds: true,
} as const;

/**
 * Load the brokerage a holding is being linked to and check the link makes
 * sense: it's a brokerage in this workspace the caller can use, the holding
 * is a kind a broker actually holds, and the two share a currency (a USD
 * wallet can't pay for an NSE stock without a conversion nobody recorded).
 */
export async function loadBrokerageForHolding(args: {
  brokerageAccountId: string;
  workspaceId: string;
  session: Session | null;
  holdingKind: string;
  holdingCurrency: string | null | undefined;
}): Promise<BrokerageAccount> {
  const account = await prisma.account.findUnique({
    where: { id: args.brokerageAccountId },
    select: BROKERAGE_SELECT,
  });
  if (!account || account.workspaceId !== args.workspaceId) {
    throw new BrokerageError("Brokerage not found", 404);
  }
  if (account.kind !== "BROKERAGE") {
    throw new BrokerageError("That account isn't a brokerage");
  }
  if (!canAccessRecord(args.session, account)) {
    throw new BrokerageError("Forbidden", 403);
  }
  if (!isBrokerageHoldingKind(args.holdingKind)) {
    throw new BrokerageError(
      "Only stocks, mutual funds and SIPs can be held in a brokerage",
    );
  }
  const holdingCurrency = args.holdingCurrency || "INR";
  if (holdingCurrency !== account.currency) {
    throw new BrokerageError(
      `${account.name}'s wallet is in ${account.currency} — it can't hold ${holdingCurrency} investments`,
    );
  }
  return account;
}

/**
 * What a BUY / SELL of `amountInr` is worth in the wallet's own currency.
 * Null for an INR wallet (the rupee amount is the wallet amount). For a
 * foreign one the trade must say what rate turned its foreign price into
 * `amountInr`; dividing back out gives the wallet-side figure, so the two
 * columns can't disagree.
 */
export function walletFxAmount(
  account: { name: string; kind: string; currency: string },
  amountInr: number,
  exchangeRate: number | null | undefined,
): number | null {
  if (!isForeignWallet(account)) return null;
  if (!exchangeRate || !(exchangeRate > 0)) {
    throw new BrokerageError(
      `Enter the ${account.currency} → INR rate — ${account.name}'s wallet is in ${account.currency}`,
    );
  }
  return round2(amountInr / exchangeRate);
}

/**
 * Refuse a debit the wallet can't cover. This is the point of the wallet:
 * you can't buy until you've funded it. Measured in the wallet's own
 * currency against its balance today.
 */
export async function assertWalletCanPay(
  account: { id: string; name: string; kind: string; currency: string },
  debit: { amountInr: number; fxAmount: number | null },
): Promise<void> {
  const bal = await computeAccountBalance(account.id);
  const foreign = isForeignWallet(account);
  const need = foreign ? (debit.fxAmount ?? 0) : debit.amountInr;
  const have = foreign ? bal.nativeBalance : bal.balance;
  if (need > have + 0.005) {
    throw new BrokerageError(
      `${account.name} has only ${formatMoney(Math.max(0, have), account.currency)} — add funds to the wallet first`,
    );
  }
}

/**
 * Category for the GST booked on a currency conversion: the seeded
 * "Bank charges" expense parent, or a workspace's own category of that
 * name. Null when neither exists — the expense is still booked, just
 * uncategorised, so a missing seed never blocks a conversion.
 */
export async function resolveBankChargesCategoryId(
  workspaceId: string,
): Promise<string | null> {
  const row = await prisma.category.findFirst({
    where: {
      name: { equals: "Bank charges", mode: "insensitive" },
      OR: [{ workspaceId }, { workspaceId: null }],
      types: { has: "EXPENSE" },
    },
    // A workspace-local category sorts ahead of the global default.
    orderBy: [{ workspaceId: { sort: "asc", nulls: "last" } }],
    select: { id: true },
  });
  return row?.id ?? null;
}
