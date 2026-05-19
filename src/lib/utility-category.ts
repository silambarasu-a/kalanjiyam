import { prisma } from "@/lib/prisma";
import type { UtilityKind } from "@/generated/prisma/client";

/**
 * Map a UtilityKind to the seeded default category name. Seeded by
 * prisma/seed.ts under the "Utilities" parent group.
 */
const KIND_TO_CATEGORY_NAME: Record<UtilityKind, string> = {
  ELECTRICITY: "Electricity",
  INTERNET: "Internet / Broadband",
  MOBILE_POSTPAID: "Mobile / Phone",
  MOBILE_PREPAID: "Mobile / Phone",
  DTH: "DTH / Cable",
  GAS: "Gas",
  WATER: "Water",
  OTHER: "Utilities",
};

/**
 * Resolve the workspace-visible Category for a given UtilityKind. Bill
 * payments + advance deposits stamp this onto the resulting Transaction
 * so cashflow / PnL reports correctly bucket utility spend.
 *
 * Returns null when no matching category is found (kept tolerant so a
 * missing seed never breaks the pay flow). Memoized within request via
 * Prisma's query cache; no extra cache layer required.
 */
export async function resolveUtilityCategoryId(
  workspaceId: string,
  kind: UtilityKind,
): Promise<string | null> {
  const name = KIND_TO_CATEGORY_NAME[kind];
  if (!name) return null;
  // Prefer a workspace-local override if present, fall back to the
  // seeded default. The seed creates rows with workspaceId=null.
  const row = await prisma.category.findFirst({
    where: {
      name,
      OR: [{ workspaceId }, { workspaceId: null }],
      types: { has: "EXPENSE" },
    },
    orderBy: [
      // workspace-local categories sort before global defaults so a
      // user-renamed category wins.
      { workspaceId: { sort: "asc", nulls: "last" } },
    ],
    select: { id: true },
  });
  return row?.id ?? null;
}
