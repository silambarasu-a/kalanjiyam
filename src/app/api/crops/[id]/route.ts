import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { cropUpdateSchema } from "@/lib/validators-domain";

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
    const ctx = await requireWorkspace("crops", "write");
    const { id } = await context.params;
    const existing = await prisma.crop.findUnique({ where: { id } });
    if (!existing || existing.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const body = await request.json();
    const parsed = cropUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const crop = await prisma.crop.update({
      where: { id },
      data: {
        name: parsed.data.name ?? existing.name,
        category: parsed.data.category ?? existing.category,
        description: parsed.data.description ?? existing.description,
        active: parsed.data.active ?? existing.active,
      },
    });
    return NextResponse.json({ id: crop.id });
  } catch (e) {
    return err(e);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireWorkspace("crops", "write");
    const { id } = await context.params;
    const existing = await prisma.crop.findUnique({ where: { id } });
    if (!existing || existing.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const batchCount = await prisma.cropBatch.count({ where: { cropId: id } });
    if (batchCount > 0) {
      return NextResponse.json(
        { error: "Crop has batches — close them first or archive the crop." },
        { status: 400 }
      );
    }
    await prisma.crop.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}
