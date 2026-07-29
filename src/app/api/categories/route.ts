import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { categoryCreateSchema } from "@/lib/validators-domain";
import { isFarmParentCategory, resolveFarmParentCategoryIds } from "@/lib/farm-categories";

function error(err: unknown) {
  if (err instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const ctx = await requireWorkspace("categories", "read");
    const url = new URL(request.url);
    const type = url.searchParams.get("type");

    // "categories" is its own feature and is not a farm feature, so the
    // permission choke-point never masks this route — the farm subtrees have
    // to be dropped explicitly here. Selection only: reporting still reads
    // each transaction's own category, or past-period totals would shift.
    const farmParentIds = ctx.farmEnabled ? [] : await resolveFarmParentCategoryIds();

    const categories = await prisma.category.findMany({
      where: {
        OR: [{ workspaceId: null, isDefault: true }, { workspaceId: ctx.workspaceId }],
        ...(type
          ? {
              types: { has: type as "INCOME" | "EXPENSE" | "INVESTMENT" | "HAND_LOAN" | "TRANSFER" },
            }
          : {}),
        ...(farmParentIds.length > 0
          ? {
              AND: [
                { id: { notIn: farmParentIds } },
                // Children go with their parent: a child left behind has no
                // parent row to hang off and renders ungrouped in the picker's
                // tree builder. The `parentCategoryId: null` branch is spelled
                // out because a bare `notIn` on a nullable column is never true
                // for NULL, which would take every top-level category with it.
                {
                  OR: [
                    { parentCategoryId: null },
                    { parentCategoryId: { notIn: farmParentIds } },
                  ],
                },
              ],
            }
          : {}),
      },
      orderBy: [{ group: "asc" }, { name: "asc" }],
    });

    return NextResponse.json({
      categories: categories.map((c) => ({
        id: c.id,
        name: c.name,
        types: c.types,
        group: c.group,
        icon: c.icon,
        isDefault: c.isDefault,
        custom: c.workspaceId === ctx.workspaceId,
        // New: parent pointer for the two-level hierarchy. Old clients
        // ignore this field — flat rendering still works as before.
        parentCategoryId: c.parentCategoryId,
      })),
    });
  } catch (err) {
    return error(err);
  }
}

/**
 * Validate a parent reference for a child category. Enforces:
 *   - parent exists
 *   - parent is visible to this workspace (default or workspace-scoped)
 *   - parent is itself top-level (parentCategoryId == null) — rejects
 *     three-level nesting
 *   - parent is not a masked farm parent when the farm module is off
 *   - parent's `types` is a superset of the child's
 *
 * Returns null when valid, otherwise an error message string.
 */
async function validateParentReference(args: {
  parentCategoryId: string;
  workspaceId: string;
  childTypes: string[];
  farmEnabled: boolean;
}): Promise<string | null> {
  // Cast to dodge a Prisma 7 deep-instantiation quirk on large schemas.
  const parent = (await (
    prisma.category.findUnique as unknown as (a: unknown) => Promise<{
      id: string;
      name: string;
      workspaceId: string | null;
      isDefault: boolean;
      parentCategoryId: string | null;
      types: string[];
    } | null>
  )({
    where: { id: args.parentCategoryId },
  }));
  if (!parent) return "Parent category not found";
  const visible = parent.workspaceId === null || parent.workspaceId === args.workspaceId;
  if (!visible) return "Parent category not found";
  // Masking leaves the farm rows in the table, so their ids stay valid FKs and
  // a client can still post one raw. Same message as the visibility check
  // above: to this workspace the parent simply isn't there, and the child
  // would be born invisible in the picker anyway.
  if (!args.farmEnabled && isFarmParentCategory(parent)) {
    return "Parent category not found";
  }
  if (parent.parentCategoryId != null) {
    return "Cannot nest more than two levels — pick a top-level parent";
  }
  // Child's types must all be present on the parent so the picker can
  // render the child under the parent for every transaction-type tab.
  const parentTypeSet = new Set(parent.types);
  for (const t of args.childTypes) {
    if (!parentTypeSet.has(t as never)) {
      return `Parent doesn't support transaction type "${t}"`;
    }
  }
  return null;
}

export async function POST(request: Request) {
  try {
    const ctx = await requireWorkspace("categories", "write");
    const body = await request.json();
    const parsed = categoryCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    if (parsed.data.parentCategoryId) {
      const err = await validateParentReference({
        parentCategoryId: parsed.data.parentCategoryId,
        workspaceId: ctx.workspaceId,
        childTypes: parsed.data.types,
        farmEnabled: ctx.farmEnabled,
      });
      if (err) {
        return NextResponse.json({ error: err }, { status: 400 });
      }
    }

    const category = await prisma.category.create({
      data: {
        workspaceId: ctx.workspaceId,
        name: parsed.data.name,
        types: parsed.data.types,
        group: parsed.data.group ?? null,
        icon: parsed.data.icon ?? null,
        parentCategoryId: parsed.data.parentCategoryId ?? null,
      },
    });
    return NextResponse.json({ id: category.id });
  } catch (err) {
    return error(err);
  }
}
