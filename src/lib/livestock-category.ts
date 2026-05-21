import { prisma } from "@/lib/prisma";
import type { LivestockEventType } from "@/generated/prisma/client";

type CategoryType = "INCOME" | "EXPENSE" | "INVESTMENT";

/**
 * Resolve the workspace-visible Category for a livestock event so the
 * Transaction row carries a sensible category and the cashflow /
 * agri-income reports bucket it correctly. Mirrors
 * `resolveUtilityCategoryId` and falls back to a `null` so a missing
 * seed never breaks the event POST.
 *
 *   SALE     → "Livestock sale" (Agricultural / INCOME) — seeded
 *   PURCHASE → "Livestock purchase" if present, else "Farm Development"
 *              (Farm Operations / EXPENSE)
 *   BIRTH/DEATH → null (informational events, no money moves)
 */
export async function resolveLivestockCategoryId(
  workspaceId: string,
  eventType: LivestockEventType,
): Promise<string | null> {
  if (eventType !== "SALE" && eventType !== "PURCHASE") return null;

  const candidates: { name: string; type: CategoryType }[] =
    eventType === "SALE"
      ? [{ name: "Livestock sale", type: "INCOME" }]
      : [
          { name: "Livestock purchase", type: "EXPENSE" },
          { name: "Farm Development", type: "EXPENSE" },
        ];

  for (const c of candidates) {
    const row = await prisma.category.findFirst({
      where: {
        name: c.name,
        OR: [{ workspaceId }, { workspaceId: null }],
        types: { has: c.type },
      },
      orderBy: [
        // Prefer a workspace-local override over the seeded default,
        // same convention as the utility-category helper.
        { workspaceId: { sort: "asc", nulls: "last" } },
      ],
      select: { id: true },
    });
    if (row) return row.id;
  }
  return null;
}
