import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import {
  attendanceBatchSchema,
  attendanceUpsertSchema,
} from "@/lib/validators-domain";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const ctx = await requireWorkspace("wages", "read");
    const url = new URL(request.url);
    const workerId = url.searchParams.get("workerId");
    const month = url.searchParams.get("month"); // YYYY-MM
    if (!workerId && !month) {
      return NextResponse.json({ error: "workerId or month required" }, { status: 400 });
    }
    if (workerId) {
      const worker = await prisma.worker.findUnique({ where: { id: workerId } });
      if (!worker || worker.workspaceId !== ctx.workspaceId) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
    }
    let dateFilter: { gte: Date; lt: Date } | undefined;
    if (month) {
      if (!/^\d{4}-\d{2}$/.test(month)) {
        return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });
      }
      const [y, m] = month.split("-").map(Number);
      dateFilter = {
        gte: new Date(Date.UTC(y, m - 1, 1)),
        lt: new Date(Date.UTC(y, m, 1)),
      };
    }
    const rows = await prisma.attendance.findMany({
      where: {
        worker: { workspaceId: ctx.workspaceId },
        ...(workerId ? { workerId } : {}),
        ...(dateFilter ? { date: dateFilter } : {}),
      },
      orderBy: { date: "desc" },
      take: workerId ? 400 : 2000,
    });
    return NextResponse.json({
      attendance: rows.map((a) => ({
        id: a.id,
        workerId: a.workerId,
        date: a.date.toISOString(),
        present: a.present,
        dailyRateOverride: a.dailyRateOverride == null ? null : Number(a.dailyRateOverride),
        quantity: a.quantity == null ? null : Number(a.quantity),
        rate: a.rate == null ? null : Number(a.rate),
        cropBatchId: a.cropBatchId,
        livestockBatchId: a.livestockBatchId,
        notes: a.notes,
      })),
    });
  } catch (e) {
    return err(e);
  }
}

// Upsert — one attendance row per (workerId, date). Accepts either:
//   • single shape: { workerId, date, present, ... }
//   • batch shape:  { date, entries: [{ workerId, present, dailyRateOverride? }], cropBatchId?, livestockBatchId?, notes? }
// The bulk-attendance modal posts one batch per selected date.
export async function POST(request: Request) {
  try {
    const ctx = await requireWorkspace("wages", "write");
    const body = await request.json();

    if (body && typeof body === "object" && "entries" in body) {
      const parsed = attendanceBatchSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
      }
      const ids = parsed.data.entries.map((e) => e.workerId);
      const valid = await prisma.worker.findMany({
        where: { id: { in: ids }, workspaceId: ctx.workspaceId },
        select: { id: true },
      });
      const validSet = new Set(valid.map((w) => w.id));
      for (const e of parsed.data.entries) {
        if (!validSet.has(e.workerId)) {
          return NextResponse.json({ error: "Worker not in workspace" }, { status: 400 });
        }
      }
      const date = new Date(parsed.data.date);
      const results = await prisma.$transaction(
        parsed.data.entries.map((e) =>
          prisma.attendance.upsert({
            where: { workerId_date: { workerId: e.workerId, date } },
            update: {
              present: e.present,
              dailyRateOverride: e.dailyRateOverride ?? null,
              quantity: null,
              rate: null,
              cropBatchId: parsed.data.cropBatchId ?? null,
              livestockBatchId: parsed.data.livestockBatchId ?? null,
              notes: parsed.data.notes,
            },
            create: {
              workerId: e.workerId,
              date,
              present: e.present,
              dailyRateOverride: e.dailyRateOverride ?? null,
              cropBatchId: parsed.data.cropBatchId ?? null,
              livestockBatchId: parsed.data.livestockBatchId ?? null,
              notes: parsed.data.notes,
            },
          })
        )
      );
      return NextResponse.json({ count: results.length });
    }

    const parsed = attendanceUpsertSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const worker = await prisma.worker.findUnique({ where: { id: parsed.data.workerId } });
    if (!worker || worker.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Worker not found" }, { status: 404 });
    }
    const date = new Date(parsed.data.date);
    const row = await prisma.attendance.upsert({
      where: { workerId_date: { workerId: parsed.data.workerId, date } },
      update: {
        present: parsed.data.present,
        dailyRateOverride: parsed.data.dailyRateOverride ?? null,
        quantity: parsed.data.quantity ?? null,
        rate: parsed.data.rate ?? null,
        cropBatchId: parsed.data.cropBatchId ?? null,
        livestockBatchId: parsed.data.livestockBatchId ?? null,
        notes: parsed.data.notes,
      },
      create: {
        workerId: parsed.data.workerId,
        date,
        present: parsed.data.present,
        dailyRateOverride: parsed.data.dailyRateOverride ?? null,
        quantity: parsed.data.quantity ?? null,
        rate: parsed.data.rate ?? null,
        cropBatchId: parsed.data.cropBatchId ?? null,
        livestockBatchId: parsed.data.livestockBatchId ?? null,
        notes: parsed.data.notes,
      },
    });
    return NextResponse.json({ id: row.id });
  } catch (e) {
    return err(e);
  }
}
