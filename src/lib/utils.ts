import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatINR(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

/**
 * Shorten an Indian bank / lender name for narrow UI surfaces.
 *   "HDFC Bank"            → "HDFC"   (already-acronym token wins)
 *   "ICICI Bank"           → "ICICI"
 *   "RBL Bank"             → "RBL"
 *   "City Union Bank"      → "CUB"    (initials of significant words)
 *   "State Bank of India"  → "SBI"
 *   "Punjab National Bank" → "PNB"
 *   "Bank of Baroda"       → "BB"
 *   "Axis Bank"            → "AB"
 */
const ISSUER_FILLER_WORDS = new Set(["of", "and", "the", "&"]);
export function shortenIssuer(issuer: string): string {
  const tokens = issuer.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return issuer;
  // 1. If any token is already an all-caps acronym (≥ 2 letters), use the
  //    first such token. Handles HDFC / ICICI / RBL / IDBI / UCO / CSB.
  const acronym = tokens.find((t) => /^[A-Z]{2,}$/.test(t));
  if (acronym) return acronym;
  // 2. Otherwise, build initials from significant words.
  const initials = tokens
    .filter((t) => !ISSUER_FILLER_WORDS.has(t.toLowerCase()))
    .map((t) => t[0]?.toUpperCase() ?? "")
    .join("");
  return initials || issuer;
}

/**
 * Compact account label for narrow UI surfaces (e.g. the wages "Mode" picker).
 * Card accounts are stored as "<Issuer> · <Variant>" — render them as
 * "HDFC - Millennia". Bank / cash accounts are returned unchanged.
 */
export function formatAccountLabel(name: string, kind: string): string {
  if (kind !== "CARD") return name;
  const sep = name.indexOf(" · ");
  const [issuer, variant] = sep === -1 ? [name, ""] : [name.slice(0, sep), name.slice(sep + 3)];
  const short = shortenIssuer(issuer);
  return variant ? `${short} - ${variant}` : short;
}

/**
 * Compute the spendable amount on an account.
 *   BANK / CASH → balance
 *   CARD       → availableLimit (pool-aware; null if no limit set)
 */
export function accountSpendable(a: {
  kind: string;
  balance: number;
  availableLimit?: number | null;
}): number | null {
  if (a.kind === "CARD") return a.availableLimit ?? null;
  return a.balance;
}

/**
 * Build a NativeSelect option from an account row, with `disabled=true`
 * when `amount` exceeds the spendable amount on that account. Used by the
 * wages / expenses / investments pickers so a user can't select a card or
 * bank that doesn't have enough funds for the entered amount.
 */
export function buildAccountOption(
  a: {
    id: string;
    name: string;
    kind: string;
    balance: number;
    availableLimit?: number | null;
  },
  amount: number,
): { value: string; label: string; hint?: string; disabled?: boolean } {
  const spendable = accountSpendable(a);
  const insufficient = spendable != null && amount > 0 && amount > spendable;
  const hint =
    spendable == null
      ? undefined
      : `₹${spendable.toLocaleString("en-IN")}`;
  return {
    value: a.id,
    label: formatAccountLabel(a.name, a.kind),
    hint,
    disabled: insufficient,
  };
}
