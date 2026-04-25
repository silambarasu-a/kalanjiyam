import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { landCreateSchema } from "@/lib/validators-domain";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function GET() {
  try {
    const ctx = await requireWorkspace("crops", "read");
    const lands = await prisma.land.findMany({
      where: { workspaceId: ctx.workspaceId },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    });
    return NextResponse.json({
      lands: lands.map((l) => ({
        id: l.id,
        name: l.name,
        area: l.area == null ? null : Number(l.area),
        areaUnit: l.areaUnit,
        location: l.location,
        notes: l.notes,
        active: l.active,
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
    const parsed = landCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const land = await prisma.land.create({
      data: {
        workspaceId: ctx.workspaceId,
        name: parsed.data.name,
        area: parsed.data.area ?? null,
        areaUnit: parsed.data.areaUnit ?? null,
        location: parsed.data.location,
        notes: parsed.data.notes,
      },
    });
    return NextResponse.json({ id: land.id, name: land.name });
  } catch (e) {
    return err(e);
  }
}
