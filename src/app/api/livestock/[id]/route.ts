import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { livestockUpdateSchema } from "@/lib/validators-domain";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireWorkspace("livestock", "write");
    const { id } = await context.params;
    const existing = await prisma.livestock.findUnique({ where: { id } });
    if (!existing || existing.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const body = await request.json();
    const parsed = livestockUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const livestock = await prisma.livestock.update({
      where: { id },
      data: {
        name: parsed.data.name ?? existing.name,
        species: parsed.data.species ?? existing.species,
        description: parsed.data.description ?? existing.description,
        active: parsed.data.active ?? existing.active,
      },
    });
    return NextResponse.json({ id: livestock.id });
  } catch (e) {
    return err(e);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireWorkspace("livestock", "write");
    const { id } = await context.params;
    const existing = await prisma.livestock.findUnique({ where: { id } });
    if (!existing || existing.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const batchCount = await prisma.livestockBatch.count({ where: { livestockId: id } });
    if (batchCount > 0) {
      return NextResponse.json(
        { error: "Livestock has batches — close them first or archive instead." },
        { status: 400 }
      );
    }
    await prisma.livestock.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}
