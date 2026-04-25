import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { livestockCreateSchema } from "@/lib/validators-domain";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function GET() {
  try {
    const ctx = await requireWorkspace("livestock", "read");
    const livestock = await prisma.livestock.findMany({
      where: { workspaceId: ctx.workspaceId },
      orderBy: [{ active: "desc" }, { name: "asc" }],
      include: {
        _count: { select: { batches: { where: { active: true } } } },
        batches: {
          where: { active: true },
          select: { currentCount: true },
        },
      },
    });
    return NextResponse.json({
      livestock: livestock.map((l) => ({
        id: l.id,
        name: l.name,
        species: l.species,
        description: l.description,
        active: l.active,
        activeBatchCount: l._count.batches,
        totalCount: l.batches.reduce((s, b) => s + b.currentCount, 0),
      })),
    });
  } catch (e) {
    return err(e);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireWorkspace("livestock", "write");
    const body = await request.json();
    const parsed = livestockCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const livestock = await prisma.livestock.create({
      data: {
        workspaceId: ctx.workspaceId,
        name: parsed.data.name,
        species: parsed.data.species,
        description: parsed.data.description,
      },
    });
    return NextResponse.json({ id: livestock.id });
  } catch (e) {
    return err(e);
  }
}
