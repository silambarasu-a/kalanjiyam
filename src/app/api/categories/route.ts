import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { categoryCreateSchema } from "@/lib/validators-domain";

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

    const categories = await prisma.category.findMany({
      where: {
        OR: [{ workspaceId: null, isDefault: true }, { workspaceId: ctx.workspaceId }],
        ...(type
          ? {
              types: { has: type as "INCOME" | "EXPENSE" | "INVESTMENT" | "HAND_LOAN" | "TRANSFER" },
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
 *   - parent's `types` is a superset of the child's
 *
 * Returns null when valid, otherwise an error message string.
 */
async function validateParentReference(args: {
  parentCategoryId: string;
  workspaceId: string;
  childTypes: string[];
}): Promise<string | null> {
  const parent = await prisma.category.findUnique({
    where: { id: args.parentCategoryId },
  });
  if (!parent) return "Parent category not found";
  const visible = parent.workspaceId === null || parent.workspaceId === args.workspaceId;
  if (!visible) return "Parent category not found";
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
