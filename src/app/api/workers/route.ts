import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { workerCreateSchema } from "@/lib/validators-domain";
import { computeWorkerBalance } from "@/lib/worker-balance";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[workers]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const ctx = await requireWorkspace("workers", "read");
    const url = new URL(request.url);
    const includeArchived = url.searchParams.get("archived") === "true";
    const workers = await prisma.worker.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        ...(includeArchived ? {} : { active: true }),
      },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    });
    const balances = await Promise.all(workers.map((w) => computeWorkerBalance(w.id)));
    return NextResponse.json({
      workers: workers.map((w, i) => ({
        id: w.id,
        name: w.name,
        phone: w.phone,
        dailyRate: w.dailyRate == null ? null : Number(w.dailyRate),
        settlementCadence: w.settlementCadence,
        customCadenceDays: w.customCadenceDays,
        active: w.active,
        archivedAt: w.archivedAt?.toISOString() ?? null,
        balance: balances[i].balance,
        daysWorked: balances[i].daysWorked,
      })),
    });
  } catch (e) {
    return err(e);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireWorkspace("workers", "write");
    const body = await request.json();
    const parsed = workerCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const worker = await prisma.worker.create({
      data: {
        workspaceId: ctx.workspaceId,
        name: parsed.data.name,
        phone: parsed.data.phone,
        dailyRate: parsed.data.dailyRate ?? null,
        settlementCadence: parsed.data.settlementCadence ?? "MONTHLY",
        customCadenceDays: parsed.data.customCadenceDays ?? null,
      },
    });
    return NextResponse.json({ id: worker.id });
  } catch (e) {
    return err(e);
  }
}
