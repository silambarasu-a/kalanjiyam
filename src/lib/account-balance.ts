import { prisma } from "@/lib/prisma";

export type AccountBalance = {
  accountId: string;
  openingBalance: number;
  income: number;
  expense: number;
  transfersIn: number;
  transfersOut: number;
  balance: number;
};

/**
 * Live balance for a bank/cash/wallet account.
 *
 * BANK/CASH/WALLET: balance = opening + income - expense + transfersIn - transfersOut
 * CARD (credit): "balance" represents the outstanding owed; it grows with expenses,
 *   drops with payments. balance = opening + expense - income. (In this codebase,
 *   credit-card "accounts" receive a statement payment as income — a transfer-in
 *   from the payer bank account.)
 */
export async function computeAccountBalance(accountId: string): Promise<AccountBalance> {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { openingBalance: true, kind: true },
  });
  if (!account) throw new Error("Account not found");

  const [incomeAgg, expenseAgg, inAgg, outAgg] = await Promise.all([
    prisma.transaction.aggregate({
      where: { accountId, type: "INCOME", transferId: null },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: {
        accountId,
        OR: [
          { type: "EXPENSE", transferId: null },
          { type: "INVESTMENT", investmentAction: "BUY", transferId: null },
        ],
      },
      _sum: { amount: true },
    }),
    prisma.transfer.aggregate({
      where: { toAccountId: accountId },
      _sum: { amount: true },
    }),
    prisma.transfer.aggregate({
      where: { fromAccountId: accountId },
      _sum: { amount: true },
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

  return {
    accountId,
    openingBalance: opening,
    income,
    expense,
    transfersIn,
    transfersOut,
    balance,
  };
}
