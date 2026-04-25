/**
 * Curated list of common Indian banks + NBFCs / lenders. Used by the bank
 * picker on Account, Card, and Loan forms so users don't free-text bank
 * names. Sorted by category, then alphabetically. Add to this list rather
 * than letting users type free-form.
 */

export type BankCategory =
  | "Public sector"
  | "Private"
  | "Small finance"
  | "Payments"
  | "Foreign"
  | "Cooperative"
  | "NBFC / lender";

export type Bank = {
  /** Display name. Stored verbatim on records. */
  name: string;
  /** Short tag shown next to the name in the dropdown. */
  category: BankCategory;
};

export const BANKS: ReadonlyArray<Bank> = [
  // ── Public sector ────────────────────────────────────────────────────
  { name: "Bank of Baroda", category: "Public sector" },
  { name: "Bank of India", category: "Public sector" },
  { name: "Bank of Maharashtra", category: "Public sector" },
  { name: "Canara Bank", category: "Public sector" },
  { name: "Central Bank of India", category: "Public sector" },
  { name: "Indian Bank", category: "Public sector" },
  { name: "Indian Overseas Bank", category: "Public sector" },
  { name: "Punjab & Sind Bank", category: "Public sector" },
  { name: "Punjab National Bank", category: "Public sector" },
  { name: "State Bank of India", category: "Public sector" },
  { name: "UCO Bank", category: "Public sector" },
  { name: "Union Bank of India", category: "Public sector" },

  // ── Private ──────────────────────────────────────────────────────────
  { name: "Axis Bank", category: "Private" },
  { name: "Bandhan Bank", category: "Private" },
  { name: "Catholic Syrian Bank (CSB)", category: "Private" },
  { name: "City Union Bank", category: "Private" },
  { name: "DCB Bank", category: "Private" },
  { name: "Dhanlaxmi Bank", category: "Private" },
  { name: "Federal Bank", category: "Private" },
  { name: "HDFC Bank", category: "Private" },
  { name: "ICICI Bank", category: "Private" },
  { name: "IDBI Bank", category: "Private" },
  { name: "IDFC FIRST Bank", category: "Private" },
  { name: "IndusInd Bank", category: "Private" },
  { name: "Jammu & Kashmir Bank", category: "Private" },
  { name: "Karnataka Bank", category: "Private" },
  { name: "Karur Vysya Bank", category: "Private" },
  { name: "Kotak Mahindra Bank", category: "Private" },
  { name: "Nainital Bank", category: "Private" },
  { name: "RBL Bank", category: "Private" },
  { name: "South Indian Bank", category: "Private" },
  { name: "Tamilnad Mercantile Bank", category: "Private" },
  { name: "Yes Bank", category: "Private" },

  // ── Small finance ────────────────────────────────────────────────────
  { name: "AU Small Finance Bank", category: "Small finance" },
  { name: "Capital Small Finance Bank", category: "Small finance" },
  { name: "ESAF Small Finance Bank", category: "Small finance" },
  { name: "Equitas Small Finance Bank", category: "Small finance" },
  { name: "Fincare Small Finance Bank", category: "Small finance" },
  { name: "Jana Small Finance Bank", category: "Small finance" },
  { name: "North East Small Finance Bank", category: "Small finance" },
  { name: "Shivalik Small Finance Bank", category: "Small finance" },
  { name: "Suryoday Small Finance Bank", category: "Small finance" },
  { name: "Ujjivan Small Finance Bank", category: "Small finance" },
  { name: "Unity Small Finance Bank", category: "Small finance" },
  { name: "Utkarsh Small Finance Bank", category: "Small finance" },

  // ── Payments ─────────────────────────────────────────────────────────
  { name: "Airtel Payments Bank", category: "Payments" },
  { name: "Fino Payments Bank", category: "Payments" },
  { name: "India Post Payments Bank", category: "Payments" },
  { name: "Jio Payments Bank", category: "Payments" },
  { name: "NSDL Payments Bank", category: "Payments" },
  { name: "Paytm Payments Bank", category: "Payments" },

  // ── Foreign ──────────────────────────────────────────────────────────
  { name: "Bank of America", category: "Foreign" },
  { name: "Barclays Bank", category: "Foreign" },
  { name: "BNP Paribas", category: "Foreign" },
  { name: "Citibank", category: "Foreign" },
  { name: "DBS Bank India", category: "Foreign" },
  { name: "Deutsche Bank", category: "Foreign" },
  { name: "HSBC India", category: "Foreign" },
  { name: "Standard Chartered", category: "Foreign" },

  // ── NBFC / lender (loans; some also issue cards) ─────────────────────
  { name: "Bajaj Finance", category: "NBFC / lender" },
  { name: "Cholamandalam Finance", category: "NBFC / lender" },
  { name: "HDB Financial Services", category: "NBFC / lender" },
  { name: "L&T Finance", category: "NBFC / lender" },
  { name: "Mahindra Finance", category: "NBFC / lender" },
  { name: "Muthoot Finance", category: "NBFC / lender" },
  { name: "Manappuram Finance", category: "NBFC / lender" },
  { name: "Piramal Capital", category: "NBFC / lender" },
  { name: "Shriram Finance", category: "NBFC / lender" },
  { name: "Tata Capital", category: "NBFC / lender" },
];

/** Sentinel value used when the user wants to type a name not in the list. */
export const BANK_OTHER = "__OTHER__";

/** Build the option groups used by the picker — preserves stable category order. */
const CATEGORY_ORDER: BankCategory[] = [
  "Public sector",
  "Private",
  "Small finance",
  "Payments",
  "Foreign",
  "Cooperative",
  "NBFC / lender",
];

export function groupedBanks(): Array<{ category: BankCategory; banks: Bank[] }> {
  const byCat = new Map<BankCategory, Bank[]>();
  for (const b of BANKS) {
    if (!byCat.has(b.category)) byCat.set(b.category, []);
    byCat.get(b.category)!.push(b);
  }
  return CATEGORY_ORDER.filter((c) => byCat.has(c)).map((c) => ({
    category: c,
    banks: [...byCat.get(c)!].sort((a, b) => a.name.localeCompare(b.name)),
  }));
}
