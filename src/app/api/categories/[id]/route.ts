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
    const category = await prisma.category.update({
      where: { id },
      data: {
        name: parsed.data.name ?? existing.name,
        types: parsed.data.types ?? existing.types,
        group: parsed.data.group ?? existing.group,
        icon: parsed.data.icon ?? existing.icon,
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
    await prisma.category.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return error(err);
  }
}
