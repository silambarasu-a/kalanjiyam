import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { eventCreateSchema } from "@/lib/validators-domain";
import { EventKind } from "@/generated/prisma/client";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[events]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

/**
 * GET /api/events?status=active|all
 *
 * Returns events ordered by startedAt desc, with `totalSpent`
 * aggregated from linked transactions. Default scope: active only.
 * Pass `?status=all` to include archived (active=false) events.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireWorkspace("events", "read");
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") ?? "active";

    const events = await prisma.event.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        ...(status === "all" ? {} : { active: true }),
      },
      orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
    });

    // Aggregate spend per event in one query.
    const ids = events.map((e) => e.id);
    const sums = ids.length
      ? await prisma.transaction.groupBy({
          by: ["eventId"],
          where: {
            workspaceId: ctx.workspaceId,
            eventId: { in: ids },
            type: "EXPENSE",
            transferId: null,
          },
          _sum: { amount: true },
          _count: true,
        })
      : [];
    const sumsByEvent = new Map(
      sums.map((s) => [
        s.eventId as string,
        { total: Number(s._sum.amount ?? 0), txnCount: s._count },
      ]),
    );

    return NextResponse.json({
      events: events.map((e) => {
        const agg = sumsByEvent.get(e.id);
        return {
          id: e.id,
          name: e.name,
          kind: e.kind,
          startedAt: e.startedAt.toISOString(),
          endedAt: e.endedAt?.toISOString() ?? null,
          notes: e.notes,
          budget: e.budget == null ? null : Number(e.budget),
          active: e.active,
          totalSpent: agg?.total ?? 0,
          txnCount: agg?.txnCount ?? 0,
        };
      }),
    });
  } catch (e) {
    return err(e);
  }
}

/**
 * POST /api/events — create a new event.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireWorkspace("events", "write");
    const body = await request.json();
    const parsed = eventCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const data = parsed.data;
    const created = await prisma.event.create({
      data: {
        workspaceId: ctx.workspaceId,
        name: data.name,
        kind: data.kind as EventKind,
        startedAt: new Date(data.startedAt),
        endedAt: data.endedAt ? new Date(data.endedAt) : null,
        notes: data.notes ?? null,
        budget: data.budget ?? null,
        active: data.active ?? true,
      },
    });
    return NextResponse.json({ id: created.id });
  } catch (e) {
    return err(e);
  }
}
