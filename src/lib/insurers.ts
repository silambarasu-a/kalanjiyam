/**
 * Curated list of common Indian insurance providers. Used by the insurer
 * picker on the investment form so users don't free-text policy names.
 *
 * Each insurer carries the *full set* of lines of business it actually
 * sells in India — the picker uses this to suggest e.g. HDFC ERGO when
 * the user picks Health, even though it's primarily a general insurer.
 * The first entry in `categories` is the "primary" category, used for
 * grouping when no filter is active.
 *
 * Sorted by primary category, then alphabetically. Free-text is still
 * allowed as a fallback for niche / regional insurers.
 */

export type InsurerCategory = "Life" | "Health" | "General" | "Standalone digital";

export type Insurer = {
  /** Display name. Stored verbatim on records. */
  name: string;
  /** Lines of business — primary first, additional after. */
  categories: readonly InsurerCategory[];
};

export const INSURERS: ReadonlyArray<Insurer> = [
  // ── Life (regulators allow life-only or composite; today all are life-only) ──
  { name: "Aditya Birla Sun Life Insurance", categories: ["Life"] },
  { name: "Aviva Life Insurance", categories: ["Life"] },
  { name: "Bajaj Allianz Life Insurance", categories: ["Life"] },
  { name: "Bharti AXA Life Insurance", categories: ["Life"] },
  { name: "Canara HSBC Life Insurance", categories: ["Life"] },
  { name: "Edelweiss Tokio Life Insurance", categories: ["Life"] },
  { name: "Exide Life Insurance", categories: ["Life"] },
  { name: "Future Generali India Life Insurance", categories: ["Life"] },
  { name: "HDFC Life Insurance", categories: ["Life"] },
  { name: "ICICI Prudential Life Insurance", categories: ["Life"] },
  { name: "IndiaFirst Life Insurance", categories: ["Life"] },
  { name: "Kotak Mahindra Life Insurance", categories: ["Life"] },
  { name: "Life Insurance Corporation of India (LIC)", categories: ["Life"] },
  { name: "Max Life Insurance", categories: ["Life"] },
  { name: "PNB MetLife India Insurance", categories: ["Life"] },
  { name: "Pramerica Life Insurance", categories: ["Life"] },
  { name: "Reliance Nippon Life Insurance", categories: ["Life"] },
  { name: "SBI Life Insurance", categories: ["Life"] },
  { name: "Sahara India Life Insurance", categories: ["Life"] },
  { name: "Shriram Life Insurance", categories: ["Life"] },
  { name: "Star Union Dai-ichi Life Insurance", categories: ["Life"] },
  { name: "Tata AIA Life Insurance", categories: ["Life"] },

  // ── Standalone health insurers (regulator: SAHI — health-only licence) ──
  { name: "Aditya Birla Health Insurance", categories: ["Health"] },
  { name: "Care Health Insurance", categories: ["Health"] },
  { name: "ManipalCigna Health Insurance", categories: ["Health"] },
  { name: "Niva Bupa Health Insurance", categories: ["Health"] },
  { name: "Star Health and Allied Insurance", categories: ["Health"] },

  // ── General (motor, home, travel, fire, marine, retail health) ────────
  // General insurers in India write health alongside motor/home; the
  // categories array reflects that.
  { name: "Bajaj Allianz General Insurance", categories: ["General", "Health"] },
  { name: "Cholamandalam MS General Insurance", categories: ["General", "Health"] },
  { name: "Future Generali India Insurance", categories: ["General", "Health"] },
  { name: "HDFC ERGO General Insurance", categories: ["General", "Health"] },
  { name: "ICICI Lombard General Insurance", categories: ["General", "Health"] },
  { name: "IFFCO Tokio General Insurance", categories: ["General", "Health"] },
  { name: "Kotak Mahindra General Insurance", categories: ["General", "Health"] },
  { name: "Liberty General Insurance", categories: ["General", "Health"] },
  { name: "Magma HDI General Insurance", categories: ["General", "Health"] },
  { name: "National Insurance", categories: ["General", "Health"] },
  { name: "New India Assurance", categories: ["General", "Health"] },
  { name: "Oriental Insurance", categories: ["General", "Health"] },
  { name: "Raheja QBE General Insurance", categories: ["General"] },
  { name: "Reliance General Insurance", categories: ["General", "Health"] },
  { name: "Royal Sundaram General Insurance", categories: ["General", "Health"] },
  { name: "SBI General Insurance", categories: ["General", "Health"] },
  { name: "Shriram General Insurance", categories: ["General"] },
  { name: "Tata AIG General Insurance", categories: ["General", "Health"] },
  { name: "United India Insurance", categories: ["General", "Health"] },
  { name: "Universal Sompo General Insurance", categories: ["General", "Health"] },

  // ── Standalone digital (general + health on a digital-first stack) ────
  { name: "Acko General Insurance", categories: ["Standalone digital", "General", "Health"] },
  { name: "Go Digit General Insurance", categories: ["Standalone digital", "General", "Health"] },
  { name: "Navi General Insurance", categories: ["Standalone digital", "General", "Health"] },
];

const ORDER: InsurerCategory[] = ["Life", "Health", "General", "Standalone digital"];

/**
 * Group insurers for the unfiltered picker view. Grouping is by
 * *primary* category (the first item in `categories`), so each insurer
 * appears exactly once. When the picker applies a `filterCategories`
 * filter, that view shows only insurers whose categories overlap and
 * still groups by primary category.
 */
export function groupedInsurers(
  filter?: ReadonlyArray<InsurerCategory>,
): { category: InsurerCategory; insurers: Insurer[] }[] {
  const allowed = filter && filter.length > 0 ? new Set(filter) : null;
  const map = new Map<InsurerCategory, Insurer[]>();
  for (const c of ORDER) map.set(c, []);
  for (const ins of INSURERS) {
    if (allowed && !ins.categories.some((c) => allowed.has(c))) continue;
    const primary = ins.categories[0];
    map.get(primary)?.push(ins);
  }
  return ORDER.map((category) => ({ category, insurers: map.get(category) ?? [] })).filter(
    (g) => g.insurers.length > 0,
  );
}
