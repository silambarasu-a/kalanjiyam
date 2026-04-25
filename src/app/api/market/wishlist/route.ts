import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { visibilityFilter } from "@/lib/permissions";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[market/wishlist]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

const createSchema = z.object({
  symbol: z.string().trim().toUpperCase().min(1, "Symbol is required").max(40),
  name: z.string().trim().max(160).optional(),
  exchange: z.string().trim().max(20).optional(),
  targetPrice: z.coerce.number().nonnegative().optional(),
  notes: z.string().trim().max(500).optional(),
});

export async function GET() {
  try {
    const ctx = await requireWorkspace("investments", "read");
    const session = await auth();
    const items = await prisma.stockWishlist.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        ...visibilityFilter(session, ctx.ownOnly),
      },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(
      items.map((i) => ({
        id: i.id,
        symbol: i.symbol,
        name: i.name,
        exchange: i.exchange,
        targetPrice: i.targetPrice == null ? null : Number(i.targetPrice).toString(),
        notes: i.notes,
      }))
    );
  } catch (e) {
    return err(e);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireWorkspace("investments", "write");
    const body = await request.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const item = await prisma.stockWishlist.create({
      data: {
        workspaceId: ctx.workspaceId,
        ownerUserId: ctx.userId,
        symbol: parsed.data.symbol,
        name: parsed.data.name || null,
        exchange: parsed.data.exchange || null,
        targetPrice: parsed.data.targetPrice ?? null,
        notes: parsed.data.notes || null,
      },
    });

    return NextResponse.json({ id: item.id });
  } catch (e) {
    return err(e);
  }
}
