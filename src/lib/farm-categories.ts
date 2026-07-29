import { prisma } from "@/lib/prisma";

/**
 * The two farm-only branches of the seeded default category tree.
 *
 * Matching is by NAME on the GLOBAL rows (workspaceId=null, isDefault=true)
 * rather than by a schema column, because these rows are shared by every
 * tenant: one `Category` row backs all workspaces and `Transaction.categoryId`
 * FKs straight into it. A per-row "isFarm" column would therefore be a global
 * fact, not a per-workspace one — flipping the farm module off for one
 * workspace can never touch the row itself. The flag masks at read time; it
 * never deletes, so a workspace that turns the farm back on (or an old
 * farm-tagged transaction that must still render and unwind) is unaffected.
 *
 * These names must stay in step with the parents actually seeded by
 * `prisma/seed.ts`, which spells them as keys of its category TREE literal
 * ("Farm Operations" under EXPENSE, "Agricultural" under INCOME). Rename one
 * there and you must rename it here — the seed can't import these because the
 * names are its object keys, not values.
 */

/** EXPENSE parent: Farm Development, Wage, Feed, Vaccination, Seeds / Planting. */
export const FARM_EXPENSE_PARENT_CATEGORY = "Farm Operations";

/** INCOME parent: Crop sale, Livestock sale, Lease income. */
export const FARM_INCOME_PARENT_CATEGORY = "Agricultural";

/**
 * Every farm-only top-level default category. Nothing else in the seeded tree
 * is farm-specific — "Wage" here is the farm wage child, distinct from the
 * household categories, and lives under `Farm Operations`.
 */
export const FARM_PARENT_CATEGORY_NAMES = [
  FARM_EXPENSE_PARENT_CATEGORY,
  FARM_INCOME_PARENT_CATEGORY,
] as const;

/**
 * True when an already-fetched category row is one of the global farm parents.
 *
 * Scoped to `workspaceId === null && isDefault` on purpose: a workspace is free
 * to create its own category called "Agricultural", and that one is its own
 * business — it must never be collateral damage of the farm switch.
 */
export function isFarmParentCategory(row: {
  name: string;
  workspaceId: string | null;
  isDefault: boolean;
  parentCategoryId: string | null;
}): boolean {
  if (row.workspaceId !== null || !row.isDefault || row.parentCategoryId !== null) {
    return false;
  }
  return (FARM_PARENT_CATEGORY_NAMES as readonly string[]).includes(row.name);
}

/**
 * Resolve the ids of the global farm parents so callers can exclude those ids
 * *and their children* from a category listing. Returns [] when the seed has
 * not run — the caller then filters nothing, which is the safe direction.
 */
export async function resolveFarmParentCategoryIds(): Promise<string[]> {
  const rows = await prisma.category.findMany({
    where: {
      workspaceId: null,
      isDefault: true,
      parentCategoryId: null,
      name: { in: [...FARM_PARENT_CATEGORY_NAMES] },
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}
