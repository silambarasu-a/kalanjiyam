import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { cropCreateSchema } from "@/lib/validators-domain";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function GET() {
  try {
    const ctx = await requireWorkspace("crops", "read");
    const crops = await prisma.crop.findMany({
      where: { workspaceId: ctx.workspaceId },
      orderBy: [{ active: "desc" }, { name: "asc" }],
      include: {
        _count: { select: { batches: { where: { active: true } } } },
      },
    });
    return NextResponse.json({
      crops: crops.map((c) => ({
        id: c.id,
        name: c.name,
        category: c.category,
        description: c.description,
        active: c.active,
        activeBatchCount: c._count.batches,
      })),
    });
  } catch (e) {
    return err(e);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireWorkspace("crops", "write");
    const body = await request.json();
    const parsed = cropCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const crop = await prisma.crop.create({
      data: {
        workspaceId: ctx.workspaceId,
        name: parsed.data.name,
        category: parsed.data.category,
        description: parsed.data.description,
      },
    });
    return NextResponse.json({ id: crop.id });
  } catch (e) {
    return err(e);
  }
}
