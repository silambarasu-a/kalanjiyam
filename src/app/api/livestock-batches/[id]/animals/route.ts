import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { livestockAnimalCreateSchema } from "@/lib/validators-domain";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[animals]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

async function loadBatch(id: string, workspaceId: string) {
  const batch = await prisma.livestockBatch.findUnique({
    where: { id },
    include: { livestock: { select: { workspaceId: true } } },
  });
  if (!batch || batch.livestock.workspaceId !== workspaceId) return null;
  return batch;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireWorkspace("livestock", "read");
    const { id } = await context.params;
    const batch = await loadBatch(id, ctx.workspaceId);
    if (!batch) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const rows = await prisma.livestockAnimal.findMany({
      where: { batchId: id },
      orderBy: [{ active: "desc" }, { tagNumber: "asc" }],
    });
    return NextResponse.json({
      animals: rows.map((a) => ({
        id: a.id,
        tagNumber: a.tagNumber,
        name: a.name,
        sex: a.sex,
        dob: a.dob?.toISOString() ?? null,
        breed: a.breed,
        color: a.color,
        notes: a.notes,
        active: a.active,
      })),
    });
  } catch (e) {
    return err(e);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireWorkspace("livestock", "write");
    const { id } = await context.params;
    const batch = await loadBatch(id, ctx.workspaceId);
    if (!batch) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const body = await request.json();
    const parsed = livestockAnimalCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const d = parsed.data;
    try {
      const row = await prisma.livestockAnimal.create({
        data: {
          batchId: id,
          tagNumber: d.tagNumber,
          name: d.name ?? null,
          sex: d.sex,
          dob: d.dob ? new Date(d.dob) : null,
          breed: d.breed ?? null,
          color: d.color ?? null,
          notes: d.notes ?? null,
        },
      });
      return NextResponse.json({ id: row.id });
    } catch (e) {
      if (e instanceof Error && e.message.includes("Unique constraint")) {
        return NextResponse.json(
          { error: `Tag "${d.tagNumber}" is already used in this batch` },
          { status: 409 },
        );
      }
      throw e;
    }
  } catch (e) {
    return err(e);
  }
}
