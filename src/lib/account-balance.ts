import { prisma } from "@/lib/prisma";
import { HOME_CURRENCY, isForeignCurrency } from "@/lib/brokerage";

export type AccountBalance = {
  accountId: string;
  openingBalance: number;
  income: number;
  expense: number;
  transfersIn: number;
  transfersOut: number;
  /** Always INR. For a foreign-currency wallet this is its rupee book value. */
  balance: number;
  /** The account's own currency — "INR" for everything but a foreign wallet. */
  currency: string;
  /**
   * Balance in the account's own currency. Identical to `balance` for an INR
   * account; for a foreign-currency wallet it's the figure that matches the
   * broker's statement.
   */
  nativeBalance: number;
  /**
   * Foreign wallets only: INR per one unit of the wallet's currency, averaged
   * over what's still in it (`balance / nativeBalance`). Null when the wallet
   * is INR or empty.
   */
  avgRate: number | null;
};

/**
 * Which non-transfer rows count as money INTO an account.
 *
 * An INVESTMENT/SELL has never credited a bank / cash / wallet account —
 * balances there are built from INCOME only — and that stays as it is. A
 * brokerage wallet is different: sale proceeds land in it by definition
 * (every SELL on a linked holding is forced to post there), so for that kind
 * a SELL is an inflow. Shared so the reports that redo this arithmetic with
 * a date filter agree with the live figure.
 */
export function isAccountInflow(
  accountKind: string,
  row: { type: string; investmentAction?: string | null },
): boolean {
  if (row.type === "INCOME") return true;
  return (
    accountKind === "BROKERAGE" &&
    row.type === "INVESTMENT" &&
    row.investmentAction === "SELL"
  );
}

/** Which non-transfer rows count as money OUT of an account. */
export function isAccountOutflow(row: {
  type: string;
  investmentAction?: string | null;
}): boolean {
  return (
    row.type === "EXPENSE" ||
    (row.type === "INVESTMENT" && row.investmentAction === "BUY")
  );
}

/**
 * Live balance for an account.
 *
 * BANK/CASH/WALLET: balance = opening + income - expense + transfersIn - transfersOut
 * BROKERAGE: same, with sale proceeds counted as income (see isAccountInflow).
 * CARD (credit): "balance" represents the outstanding owed; it grows with expenses,
 *   drops with payments. balance = opening + expense - income. (In this codebase,
 *   credit-card "accounts" receive a statement payment as income — a transfer-in
 *   from the payer bank account.)
 *
 * `balance` is INR for every account. A foreign-currency brokerage wallet
 * additionally gets `nativeBalance`, the same formula run over the `fx*`
 * columns — never `balance` divided by a rate, which would drift with every
 * conversion done at a different price.
 */
export async function computeAccountBalance(accountId: string): Promise<AccountBalance> {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: {
      openingBalance: true,
      openingFxBalance: true,
      kind: true,
      currency: true,
    },
  });
  if (!account) throw new Error("Account not found");

  const isBrokerage = account.kind === "BROKERAGE";
  const foreign = isBrokerage && isForeignCurrency(account.currency);

  const [incomeAgg, expenseAgg, inAgg, outAgg] = await Promise.all([
    prisma.transaction.aggregate({
      where: {
        accountId,
        transferId: null,
        ...(isBrokerage
          ? {
              OR: [
                { type: "INCOME" as const },
                { type: "INVESTMENT" as const, investmentAction: "SELL" as const },
              ],
            }
          : { type: "INCOME" as const }),
      },
      _sum: { amount: true, fxAmount: true },
    }),
    prisma.transaction.aggregate({
      where: {
        accountId,
        OR: [
          { type: "EXPENSE", transferId: null },
          { type: "INVESTMENT", investmentAction: "BUY", transferId: null },
        ],
      },
      _sum: { amount: true, fxAmount: true },
    }),
    prisma.transfer.aggregate({
      where: { toAccountId: accountId },
      _sum: { amount: true, fxAmount: true },
    }),
    prisma.transfer.aggregate({
      where: { fromAccountId: accountId },
      _sum: { amount: true, fxAmount: true },
    }),
  ]);

  const opening = Number(account.openingBalance);
  const income = Number(incomeAgg._sum.amount ?? 0);
  const expense = Number(expenseAgg._sum.amount ?? 0);
  const transfersIn = Number(inAgg._sum.amount ?? 0);
  const transfersOut = Number(outAgg._sum.amount ?? 0);

  const balance =
    account.kind === "CARD"
      ? opening + expense - income + transfersOut - transfersIn
      : opening + income - expense + transfersIn - transfersOut;

  let nativeBalance = balance;
  let avgRate: number | null = null;
  if (foreign) {
    nativeBalance =
      Number(account.openingFxBalance ?? 0) +
      Number(incomeAgg._sum.fxAmount ?? 0) -
      Number(expenseAgg._sum.fxAmount ?? 0) +
      Number(inAgg._sum.fxAmount ?? 0) -
      Number(outAgg._sum.fxAmount ?? 0);
    // Below a cent the ratio is noise (and the INR side is rounding dust).
    if (nativeBalance > 0.005 && balance > 0) avgRate = balance / nativeBalance;
  }

  return {
    accountId,
    openingBalance: opening,
    income,
    expense,
    transfersIn,
    transfersOut,
    balance,
    currency: foreign ? account.currency : HOME_CURRENCY,
    nativeBalance,
    avgRate,
  };
}
