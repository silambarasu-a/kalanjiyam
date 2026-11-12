/**
 * Brokerage wallets — the pure half (no prisma, no React), shared by the
 * validators, the routes and the client forms.
 *
 * A brokerage is an Account with kind = BROKERAGE: the cash you park with a
 * broker before you can buy. A domestic one is an ordinary INR account. A
 * foreign-currency one keeps the app's one rule intact — every `amount` /
 * `openingBalance` column is INR — by carrying its own-currency figure in a
 * parallel `fx*` column on each row that touches it:
 *
 *   Account.openingBalance (INR)  +  Account.openingFxBalance
 *   Transfer.amount        (INR)  +  Transfer.fxAmount
 *   Transaction.amount     (INR)  +  Transaction.fxAmount
 *
 * So INR reports keep summing `amount` unchanged (a foreign wallet shows up
 * at what it cost in rupees), and the wallet's real balance is summed from
 * the `fx*` columns. The server-side guards live in `brokerage-wallet.ts`.
 */

export const HOME_CURRENCY = "INR";

/**
 * Currencies a brokerage wallet can hold. Limited to what the holdings
 * module can price and convert — `investmentCreateBase.currency` and the
 * stock screens only know INR and USD. Adding one here is not enough on its
 * own: those need to learn it too.
 */
export const BROKERAGE_CURRENCIES = ["INR", "USD"] as const;
export type BrokerageCurrency = (typeof BROKERAGE_CURRENCIES)[number];

export const BROKERAGE_CURRENCY_LABEL: Record<BrokerageCurrency, string> = {
  INR: "INR — Indian broker (Zerodha, Groww, …)",
  USD: "USD — US broker (Vested, INDmoney, IBKR, …)",
};

/** Investment kinds that can sit in a brokerage. */
export const BROKERAGE_HOLDING_KINDS = ["STOCK", "MUTUAL_FUND", "SIP"] as const;

export function isBrokerageHoldingKind(kind: string | null | undefined): boolean {
  return (BROKERAGE_HOLDING_KINDS as readonly string[]).includes(kind ?? "");
}

export function isForeignCurrency(currency: string | null | undefined): boolean {
  return !!currency && currency !== HOME_CURRENCY;
}

/** True for a brokerage wallet held in something other than INR. */
export function isForeignWallet(
  account: { kind: string; currency?: string | null } | null | undefined,
): boolean {
  return !!account && account.kind === "BROKERAGE" && isForeignCurrency(account.currency);
}

export function currencySymbol(currency: string | null | undefined): string {
  if (!currency || currency === "INR") return "₹";
  if (currency === "USD") return "$";
  return `${currency} `;
}

/**
 * Money in a wallet's own currency, always to the paisa / cent — a wallet
 * balance is something you reconcile against the broker's statement, so
 * unlike `formatINR` it doesn't round to whole units.
 */
export function formatMoney(amount: number, currency: string | null | undefined): string {
  const cur = currency || HOME_CURRENCY;
  try {
    return new Intl.NumberFormat(cur === "INR" ? "en-IN" : "en-US", {
      style: "currency",
      currency: cur,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    // Unknown ISO code — fall back to "CODE 1,234.56".
    return `${cur} ${amount.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * GST a bank charges for converting rupees to or from a foreign currency.
 *
 * The tax isn't 18% of the money converted — it's 18% of a deemed "value of
 * service" that Rule 32(2)(b) of the CGST Rules derives from the gross INR
 * amount in three slabs:
 *
 *   up to ₹1,00,000         1% of the amount, minimum ₹250
 *   ₹1,00,000 – ₹10,00,000  ₹1,000 + 0.5% of the amount above ₹1,00,000
 *   above ₹10,00,000        ₹5,500 + 0.1% of the amount above ₹10,00,000,
 *                           capped at ₹60,000
 *
 * and that 18% is levied as 9% CGST + 9% SGST.
 *
 * This is only the form's starting estimate. Banks round differently and
 * some tax their own fee on top, so both halves stay editable and whatever
 * the user saves is what gets booked.
 */
export function forexGst(inrAmount: number): {
  taxableValue: number;
  cgst: number;
  sgst: number;
  total: number;
} {
  if (!(inrAmount > 0)) return { taxableValue: 0, cgst: 0, sgst: 0, total: 0 };
  let taxableValue: number;
  if (inrAmount <= 100_000) {
    taxableValue = Math.max(250, inrAmount * 0.01);
  } else if (inrAmount <= 1_000_000) {
    taxableValue = 1_000 + (inrAmount - 100_000) * 0.005;
  } else {
    taxableValue = Math.min(60_000, 5_500 + (inrAmount - 1_000_000) * 0.001);
  }
  const half = round2(taxableValue * 0.09);
  return {
    taxableValue: round2(taxableValue),
    cgst: half,
    sgst: half,
    total: round2(half * 2),
  };
}
