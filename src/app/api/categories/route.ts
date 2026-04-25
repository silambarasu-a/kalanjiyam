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
      })),
    });
  } catch (err) {
    return error(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireWorkspace("categories", "write");
    const body = await request.json();
    const parsed = categoryCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const category = await prisma.category.create({
      data: {
        workspaceId: ctx.workspaceId,
        name: parsed.data.name,
        types: parsed.data.types,
        group: parsed.data.group,
        icon: parsed.data.icon,
      },
    });
    return NextResponse.json({ id: category.id });
  } catch (err) {
    return error(err);
  }
}
