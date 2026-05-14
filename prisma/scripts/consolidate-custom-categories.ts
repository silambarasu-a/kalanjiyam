import "dotenv/config";
import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Consolidate workspace-scoped custom Category rows into the default
 * (workspaceId=null, isDefault=true) tree. Re-points every Transaction
 * row from the old custom Category to the matching default child, then
 * deletes the now-orphaned custom Category.
 *
 *  - Dry-run by default: prints what would happen.
 *  - Pass `--apply` to actually commit changes.
 *  - Pass `--inventory` to just list every non-default category by name
 *    with its transaction count and current parent — useful for filling
 *    in the MAPPING table below before doing a real run.
 *
 *  - Idempotent: re-running after a successful apply finds no rows to
 *    move (the old custom categories are gone).
 *  - Safety:
 *      • Only operates on rows where workspaceId IS NOT NULL AND
 *        isDefault = false. Default categories are never touched.
 *      • Skips a workspace's row if the destination default child
 *        cannot be found — logs and continues.
 *      • Refuses to delete a category that still has any transactions
 *        pointing at it after the move (shouldn't happen, but belt-
 *        and-braces).
 *
 * Mapping key = case-insensitive name of the legacy custom category.
 * If a workspace has multiple custom categories named the same (e.g.
 * "Fuel" + "fuel"), both get consolidated.
 */
const MAPPING: Array<{ from: string; toParent: string; toChild?: string | null }> = [
  // ── Vehicle ───────────────────────────────────────────────────────
  { from: "Fuel", toParent: "Vehicle", toChild: "Fuel" },
  { from: "Vehicle Service", toParent: "Vehicle", toChild: "Vehicle Service" },
  { from: "Vehicle Purchase", toParent: "Vehicle", toChild: "Vehicle Purchase" },
  { from: "Vehicle Insurance Premium", toParent: "Vehicle", toChild: "Vehicle Insurance Premium" },
  { from: "Road Tax / FC / PUC", toParent: "Vehicle", toChild: "Road Tax / FC / PUC" },
  { from: "Toll / Parking", toParent: "Vehicle", toChild: "Toll / Parking" },

  // ── Medical ───────────────────────────────────────────────────────
  { from: "Medical", toParent: "Medical", toChild: "Hospital" },
  { from: "Hospital", toParent: "Medical", toChild: "Hospital" },
  { from: "Doctor", toParent: "Medical", toChild: "Doctor consultation" },
  { from: "Doctor consultation", toParent: "Medical", toChild: "Doctor consultation" },
  { from: "Medicines", toParent: "Medical", toChild: "Medicines / Pharmacy" },
  { from: "Pharmacy", toParent: "Medical", toChild: "Medicines / Pharmacy" },
  { from: "Lab", toParent: "Medical", toChild: "Diagnostic / Lab" },
  { from: "Diagnostic", toParent: "Medical", toChild: "Diagnostic / Lab" },

  // ── Household ─────────────────────────────────────────────────────
  { from: "Grocery", toParent: "Household", toChild: "Grocery" },
  { from: "Groceries", toParent: "Household", toChild: "Grocery" },
  { from: "Maid", toParent: "Household", toChild: "Maid / Help" },
  { from: "LPG", toParent: "Household", toChild: "Cooking gas (LPG)" },
  { from: "Cooking gas", toParent: "Household", toChild: "Cooking gas (LPG)" },
  { from: "Repairs", toParent: "Household", toChild: "Repairs / Maintenance" },

  // ── Utilities ─────────────────────────────────────────────────────
  { from: "Electricity", toParent: "Utilities", toChild: "Electricity" },
  { from: "EB", toParent: "Utilities", toChild: "Electricity" },
  { from: "Water", toParent: "Utilities", toChild: "Water" },
  { from: "Internet", toParent: "Utilities", toChild: "Internet / Broadband" },
  { from: "Broadband", toParent: "Utilities", toChild: "Internet / Broadband" },
  { from: "Mobile", toParent: "Utilities", toChild: "Mobile / Phone" },
  { from: "Phone", toParent: "Utilities", toChild: "Mobile / Phone" },
  { from: "DTH", toParent: "Utilities", toChild: "DTH / Cable" },
  { from: "Cable", toParent: "Utilities", toChild: "DTH / Cable" },

  // ── Food & Dining ─────────────────────────────────────────────────
  { from: "Food", toParent: "Food & Dining", toChild: "Restaurant" },
  { from: "Restaurant", toParent: "Food & Dining", toChild: "Restaurant" },
  { from: "Dining", toParent: "Food & Dining", toChild: "Restaurant" },
  { from: "Takeaway", toParent: "Food & Dining", toChild: "Takeaway / Delivery" },
  { from: "Delivery", toParent: "Food & Dining", toChild: "Takeaway / Delivery" },
  { from: "Cafe", toParent: "Food & Dining", toChild: "Cafe / Snacks" },
  { from: "Snacks", toParent: "Food & Dining", toChild: "Cafe / Snacks" },

  // ── Shopping ──────────────────────────────────────────────────────
  { from: "Clothing", toParent: "Shopping", toChild: "Clothing" },
  { from: "Clothes", toParent: "Shopping", toChild: "Clothing" },
  { from: "Electronics", toParent: "Shopping", toChild: "Electronics / Gadgets" },
  { from: "Gadgets", toParent: "Shopping", toChild: "Electronics / Gadgets" },
  { from: "Furniture", toParent: "Shopping", toChild: "Furniture / Home" },
  { from: "Personal care", toParent: "Shopping", toChild: "Personal care" },

  // ── Travel ────────────────────────────────────────────────────────
  // No bare "Travel" mapping — TXN_OVERRIDES below routes individual
  // rows by description (bike parking → Vehicle > Parking, bus → Travel
  // > Bus, etc.). Anything still tagged "Travel" after the overrides
  // falls through and is left in place.
  { from: "Flights", toParent: "Travel", toChild: "Flights" },
  { from: "Flight", toParent: "Travel", toChild: "Flights" },
  { from: "Train", toParent: "Travel", toChild: "Train" },
  { from: "Hotel", toParent: "Travel", toChild: "Hotel / Stay" },
  { from: "Stay", toParent: "Travel", toChild: "Hotel / Stay" },
  { from: "Cab", toParent: "Travel", toChild: "Cab / Taxi" },
  { from: "Taxi", toParent: "Travel", toChild: "Cab / Taxi" },
  { from: "Uber", toParent: "Travel", toChild: "Cab / Taxi" },
  { from: "Ola", toParent: "Travel", toChild: "Cab / Taxi" },

  // ── Education ─────────────────────────────────────────────────────
  { from: "Fees", toParent: "Education", toChild: "Fees" },
  { from: "School fees", toParent: "Education", toChild: "Fees" },
  { from: "Books", toParent: "Education", toChild: "Books / Stationery" },
  { from: "Stationery", toParent: "Education", toChild: "Books / Stationery" },
  { from: "Tuition", toParent: "Education", toChild: "Coaching / Tuition" },
  { from: "Coaching", toParent: "Education", toChild: "Coaching / Tuition" },

  // ── Entertainment ─────────────────────────────────────────────────
  { from: "Movies", toParent: "Entertainment", toChild: "Movies" },
  { from: "Streaming", toParent: "Entertainment", toChild: "Streaming" },
  { from: "Netflix", toParent: "Entertainment", toChild: "Streaming" },

  // ── Insurance / Tax / Religious / Personal Care ──────────────────
  { from: "Life Insurance", toParent: "Insurance Premium", toChild: "Life" },
  { from: "Health Insurance", toParent: "Insurance Premium", toChild: "Health" },
  { from: "Income tax", toParent: "Tax", toChild: "Income tax" },
  { from: "GST", toParent: "Tax", toChild: "GST" },
  { from: "Property tax", toParent: "Tax", toChild: "Property tax" },
  { from: "Temple", toParent: "Religious & Charity", toChild: "Temple / Hundi" },
  { from: "Hundi", toParent: "Religious & Charity", toChild: "Temple / Hundi" },
  { from: "Donation", toParent: "Religious & Charity", toChild: "Donation" },
  { from: "Festival", toParent: "Religious & Charity", toChild: "Festival expense" },
  { from: "Salon", toParent: "Personal Care", toChild: "Salon / Beauty" },
  { from: "Beauty", toParent: "Personal Care", toChild: "Salon / Beauty" },
  { from: "Gym", toParent: "Personal Care", toChild: "Gym / Fitness" },

  // ── Farm Operations ───────────────────────────────────────────────
  { from: "Wage", toParent: "Farm Operations", toChild: "Wage" },
  { from: "Wages", toParent: "Farm Operations", toChild: "Wage" },
  { from: "Feed", toParent: "Farm Operations", toChild: "Feed" },
  { from: "Vaccination", toParent: "Farm Operations", toChild: "Vaccination" },
  { from: "Seeds", toParent: "Farm Operations", toChild: "Seeds / Planting" },
  { from: "Farm Development", toParent: "Farm Operations", toChild: "Farm Development" },

  // ── Family Events ─────────────────────────────────────────────────
  { from: "Wedding", toParent: "Family Events", toChild: "Wedding" },
  { from: "Birthday", toParent: "Family Events", toChild: "Birthday" },
  { from: "Anniversary", toParent: "Family Events", toChild: "Anniversary" },
];

/**
 * Per-transaction overrides. Runs BEFORE the bulk MAPPING — so when a
 * legacy custom category name is too coarse (e.g. "Travel" used for both
 * bus fares AND bike parking), description-matching pulls individual
 * rows out to the right child. Matching is case-insensitive substring
 * unless a RegExp is supplied.
 */
const TXN_OVERRIDES: Array<{
  fromCategoryName: string;
  match: string | RegExp;
  toParent: string;
  toChild: string | null;
}> = [
  // Travel — split bus / bike-parking / cab out of the catch-all.
  { fromCategoryName: "Travel", match: /bus\b/i, toParent: "Travel", toChild: "Bus" },
  { fromCategoryName: "Travel", match: /bike|parking|token/i, toParent: "Vehicle", toChild: "Parking" },
  { fromCategoryName: "Travel", match: /auto|rickshaw/i, toParent: "Travel", toChild: "Auto / Rickshaw" },
  { fromCategoryName: "Travel", match: /metro|local train|emu/i, toParent: "Travel", toChild: "Metro / Local train" },
  { fromCategoryName: "Travel", match: /uber|ola|cab|taxi/i, toParent: "Travel", toChild: "Cab / Taxi" },
];

const adapter = new PrismaPg({
  connectionString:
    process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter });

const APPLY = process.argv.includes("--apply");
const INVENTORY_ONLY = process.argv.includes("--inventory");

async function inventory() {
  const custom = await prisma.category.findMany({
    where: { isDefault: false, workspaceId: { not: null } },
    select: {
      id: true,
      name: true,
      workspaceId: true,
      parentCategoryId: true,
      types: true,
      _count: { select: { transactions: true } },
    },
    orderBy: [{ workspaceId: "asc" }, { name: "asc" }],
  });
  if (custom.length === 0) {
    console.log("No workspace-scoped non-default categories found. Nothing to do.");
    return;
  }
  console.log(`Found ${custom.length} non-default custom category row(s):\n`);
  // Group by name to make patterns obvious.
  const byName = new Map<string, typeof custom>();
  for (const c of custom) {
    const list = byName.get(c.name) ?? [];
    list.push(c);
    byName.set(c.name, list);
  }
  for (const [name, rows] of [...byName.entries()].sort()) {
    const totalTxns = rows.reduce((s, r) => s + r._count.transactions, 0);
    const wsCount = new Set(rows.map((r) => r.workspaceId)).size;
    console.log(
      `  "${name}"  — ${rows.length} row(s) across ${wsCount} workspace(s); ${totalTxns} txn(s) total`,
    );
  }
}

async function consolidate() {
  console.log(
    APPLY ? "🔥 APPLY MODE — changes will be committed." : "DRY RUN — pass --apply to commit.\n",
  );
  let movedTxns = 0;
  let deletedCats = 0;
  let skippedDestMissing = 0;
  let skippedUnmapped = 0;

  // Pre-resolve every (parent, child) destination once. When childName
  // is null we resolve to the parent itself (catch-all destination).
  const destCache = new Map<string, string>(); // key = `${parent}>${child ?? ""}` → category id
  async function resolveDest(
    parentName: string,
    childName: string | null | undefined,
  ): Promise<string | null> {
    const key = `${parentName}>${childName ?? ""}`;
    const cached = destCache.get(key);
    if (cached) return cached;
    const parent = await prisma.category.findFirst({
      where: {
        name: parentName,
        isDefault: true,
        workspaceId: null,
        parentCategoryId: null,
      },
      select: { id: true },
    });
    if (!parent) return null;
    if (childName == null) {
      destCache.set(key, parent.id);
      return parent.id;
    }
    const child = await prisma.category.findFirst({
      where: {
        name: childName,
        isDefault: true,
        workspaceId: null,
        parentCategoryId: parent.id,
      },
      select: { id: true },
    });
    if (!child) return null;
    destCache.set(key, child.id);
    return child.id;
  }

  // Build a case-insensitive lookup of mappings.
  const mapByLower = new Map<
    string,
    { toParent: string; toChild: string | null | undefined }
  >();
  for (const m of MAPPING) {
    mapByLower.set(m.from.trim().toLowerCase(), {
      toParent: m.toParent,
      toChild: m.toChild ?? null,
    });
  }

  const custom = await prisma.category.findMany({
    where: { isDefault: false, workspaceId: { not: null } },
    select: {
      id: true,
      name: true,
      workspaceId: true,
      _count: { select: { transactions: true } },
    },
    orderBy: [{ workspaceId: "asc" }, { name: "asc" }],
  });

  // Track per-category how many txns pass-1 overrides matched. Used to
  // predict "category will be empty" in dry-run mode (where DB count
  // doesn't reflect the un-committed moves).
  const overrideMatchCount = new Map<string, number>();

  // ── Pass 1: per-transaction overrides (description-matched). Pull
  // specific rows out of a coarse legacy category before the bulk
  // re-point. Each override matched is logged + counted.
  let overrideMoved = 0;
  for (const oldCat of custom) {
    const overridesForCat = TXN_OVERRIDES.filter(
      (o) => o.fromCategoryName.trim().toLowerCase() === oldCat.name.trim().toLowerCase(),
    );
    if (overridesForCat.length === 0) continue;

    const txns = await prisma.transaction.findMany({
      where: { categoryId: oldCat.id },
      select: { id: true, description: true, amount: true, date: true },
    });
    for (const t of txns) {
      const hit = overridesForCat.find((o) =>
        typeof o.match === "string"
          ? t.description.toLowerCase().includes(o.match.toLowerCase())
          : o.match.test(t.description),
      );
      if (!hit) continue;
      const destId = await resolveDest(hit.toParent, hit.toChild);
      const destLabel = hit.toChild
        ? `${hit.toParent} > ${hit.toChild}`
        : `${hit.toParent} (parent)`;
      if (!destId) {
        console.warn(`  ✗ override dest missing: ${destLabel} — txn ${t.id} skipped`);
        continue;
      }
      console.log(
        `  → override "${oldCat.name}" → ${destLabel}: ${t.date.toISOString().slice(0, 10)} ₹${Number(t.amount).toLocaleString("en-IN")} "${t.description}"`,
      );
      overrideMatchCount.set(
        oldCat.id,
        (overrideMatchCount.get(oldCat.id) ?? 0) + 1,
      );
      if (APPLY) {
        await prisma.transaction.update({
          where: { id: t.id },
          data: { categoryId: destId },
        });
        overrideMoved++;
      }
    }
  }

  // ── Pass 2: bulk re-point by category name (the existing MAPPING flow).
  for (const oldCat of custom) {
    const dest = mapByLower.get(oldCat.name.trim().toLowerCase());
    if (!dest) {
      // Unmapped — but if pass-1 overrides will fully empty it, garbage-collect.
      const matched = overrideMatchCount.get(oldCat.id) ?? 0;
      const predictedRemaining = oldCat._count.transactions - matched;
      if (matched > 0 && predictedRemaining === 0) {
        console.log(
          `  ✓ "${oldCat.name}" emptied by overrides — ${APPLY ? "deleting" : "would delete"}`,
        );
        if (APPLY) {
          await prisma.category.updateMany({
            where: { parentCategoryId: oldCat.id },
            data: { parentCategoryId: null },
          });
          await prisma.category.delete({ where: { id: oldCat.id } });
          deletedCats++;
        }
        continue;
      }
      console.log(
        `  – unmapped: "${oldCat.name}" (ws ${oldCat.workspaceId}, ${predictedRemaining} txn${predictedRemaining === 1 ? "" : "s"} left after overrides) — skipped`,
      );
      skippedUnmapped++;
      continue;
    }
    const destChildId = await resolveDest(dest.toParent, dest.toChild);
    const destLabel = dest.toChild
      ? `${dest.toParent} > ${dest.toChild}`
      : `${dest.toParent} (parent)`;
    if (!destChildId) {
      console.warn(
        `  ✗ destination missing: ${destLabel} (for "${oldCat.name}") — skipped`,
      );
      skippedDestMissing++;
      continue;
    }
    console.log(
      `  ✓ "${oldCat.name}" → ${destLabel}  (ws ${oldCat.workspaceId}, ${oldCat._count.transactions} txn${oldCat._count.transactions === 1 ? "" : "s"})`,
    );
    if (!APPLY) continue;

    // Re-point transactions, then delete the old custom category.
    await prisma.$transaction(async (tx) => {
      const r = await tx.transaction.updateMany({
        where: { categoryId: oldCat.id },
        data: { categoryId: destChildId },
      });
      movedTxns += r.count;

      const remaining = await tx.transaction.count({
        where: { categoryId: oldCat.id },
      });
      if (remaining > 0) {
        // Defensive: only delete when we know nothing still references it.
        console.warn(
          `    ! ${remaining} txn(s) still reference ${oldCat.id}; leaving category in place`,
        );
        return;
      }
      // Detach any children before delete (defensive — workspace custom
      // categories typically have no children, but onDelete=SetNull would
      // handle it anyway).
      await tx.category.updateMany({
        where: { parentCategoryId: oldCat.id },
        data: { parentCategoryId: null },
      });
      await tx.category.delete({ where: { id: oldCat.id } });
      deletedCats++;
    });
  }

  console.log(
    `\nSummary: ${APPLY ? "moved" : "would move"} ${movedTxns + overrideMoved} transaction(s) ` +
      `(${overrideMoved} via overrides, ${movedTxns} via bulk); ` +
      `${APPLY ? "deleted" : "would delete"} ${deletedCats} category row(s); ` +
      `${skippedUnmapped} unmapped; ${skippedDestMissing} destination(s) missing.`,
  );
  if (!APPLY) {
    console.log(`\nRe-run with --apply to commit.`);
  }
}

async function main() {
  if (INVENTORY_ONLY) {
    await inventory();
    return;
  }
  await consolidate();
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
