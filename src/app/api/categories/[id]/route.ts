import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { categoryUpdateSchema } from "@/lib/validators-domain";

function error(err: unknown) {
  if (err instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

/**
 * Validate a parent reference for a child category. Same rules as the
 * POST handler but additionally rejects self-parenting and rejects
 * setting a parent on a row that already has children (would push the
 * tree past two levels).
 */
async function validateParentReference(args: {
  parentCategoryId: string;
  workspaceId: string;
  childTypes: string[];
  childId: string;
}): Promise<string | null> {
  if (args.parentCategoryId === args.childId) {
    return "A category cannot be its own parent";
  }
  const parent = await prisma.category.findUnique({
    where: { id: args.parentCategoryId },
  });
  if (!parent) return "Parent category not found";
  const visible =
    parent.workspaceId === null || parent.workspaceId === args.workspaceId;
  if (!visible) return "Parent category not found";
  if (parent.parentCategoryId != null) {
    return "Cannot nest more than two levels — pick a top-level parent";
  }
  const parentTypeSet = new Set(parent.types);
  for (const t of args.childTypes) {
    if (!parentTypeSet.has(t as never)) {
      return `Parent doesn't support transaction type "${t}"`;
    }
  }
  // Two-level rule: the child being patched must not itself have
  // children. If it does, parenting it would create a 3-level tree.
  const childChildren = await prisma.category.count({
    where: { parentCategoryId: args.childId },
  });
  if (childChildren > 0) {
    return "This category already has children — make those children top-level first, or move them under the new parent.";
  }
  return null;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireWorkspace("categories", "write");
    const { id } = await context.params;
    const body = await request.json();
    const parsed = categoryUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const existing = await prisma.category.findUnique({ where: { id } });
    if (!existing || existing.workspaceId !== ctx.workspaceId) {
      return NextResponse.json(
        { error: "Default categories cannot be edited." },
        { status: 400 }
      );
    }

    const nextTypes = parsed.data.types ?? existing.types;
    if (parsed.data.parentCategoryId !== undefined) {
      // null means "make this top-level" — always allowed.
      if (parsed.data.parentCategoryId !== null) {
        const err = await validateParentReference({
          parentCategoryId: parsed.data.parentCategoryId,
          workspaceId: ctx.workspaceId,
          childTypes: nextTypes,
          childId: id,
        });
        if (err) {
          return NextResponse.json({ error: err }, { status: 400 });
        }
      }
    }

    const category = await prisma.category.update({
      where: { id },
      data: {
        name: parsed.data.name ?? existing.name,
        types: parsed.data.types ?? existing.types,
        group: parsed.data.group ?? existing.group,
        icon: parsed.data.icon ?? existing.icon,
        parentCategoryId:
          parsed.data.parentCategoryId === undefined
            ? existing.parentCategoryId
            : parsed.data.parentCategoryId,
      },
    });
    return NextResponse.json({ id: category.id });
  } catch (err) {
    return error(err);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireWorkspace("categories", "write");
    const { id } = await context.params;
    const existing = await prisma.category.findUnique({ where: { id } });
    if (!existing || existing.workspaceId !== ctx.workspaceId) {
      return NextResponse.json(
        { error: "Default categories cannot be deleted." },
        { status: 400 }
      );
    }
    // Refuse if the category is in use — the user should re-categorise
    // those transactions first. The FK is `SetNull` at the DB level
    // (children) but transaction.categoryId is also `SetNull`, so a
    // forced delete would leave transactions uncategorised silently.
    const txCount = await prisma.transaction.count({ where: { categoryId: id } });
    if (txCount > 0) {
      return NextResponse.json(
        {
          error: `This category is used by ${txCount} transaction${txCount === 1 ? "" : "s"}. Re-categorise them first, then delete.`,
        },
        { status: 409 }
      );
    }
    await prisma.category.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return error(err);
  }
}
