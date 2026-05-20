import { NextResponse } from "next/server";
import { z } from "zod";
import {
  WeighingPhase,
  MortalityCause,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[livestock-batches/import-logs]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

const feedRow = z.object({
  batchName: z.string().trim().min(1).max(80),
  date: z.string(),
  amount: z.number().positive(),
  quantity: z.number().positive().optional().nullable(),
  unit: z.string().trim().max(20).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});
const weighingRow = z.object({
  batchName: z.string().trim().min(1).max(80),
  date: z.string(),
  phase: z.enum(["ARRIVAL", "INTERIM", "WEEKLY", "EXIT"]).default("INTERIM"),
  sampleSize: z.number().int().positive().default(1),
  totalKg: z.number().positive(),
  notes: z.string().trim().max(500).optional().nullable(),
});
const mortalityRow = z.object({
  batchName: z.string().trim().min(1).max(80),
  date: z.string(),
  count: z.number().int().positive().default(1),
  cause: z
    .enum([
      "UNKNOWN",
      "DISEASE",
      "PREDATOR",
      "INJURY",
      "HEAT",
      "COLD",
      "STAMPEDE",
      "OTHER",
    ])
    .default("UNKNOWN"),
  culled: z.boolean().optional().default(false),
  notes: z.string().trim().max(500).optional().nullable(),
});

class ImportError extends Error {}

/**
 * Bulk-create feed logs / weighings / mortality logs. The whole batch
 * runs in a single $transaction so a single bad row rolls everything
 * back. Mortality entries decrement `currentCount` along the way; if
 * the cumulative deaths would push a batch below zero, the whole
 * import aborts.
 *
 * Caller posts `{ entity: "feed" | "weighings" | "mortality", rows: [...] }`.
 * `batchName` must resolve to an existing LivestockBatch in the
 * workspace (we don't auto-create batches here — use the batch
 * importer first).
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireWorkspace("livestock", "write");
    const body = (await request.json()) as { entity?: string };
    const entity = body.entity;
    if (!entity || !["feed", "weighings", "mortality"].includes(entity)) {
      return NextResponse.json(
        { error: "entity must be 'feed', 'weighings', or 'mortality'" },
        { status: 400 },
      );
    }

    const schema =
      entity === "feed"
        ? feedRow
        : entity === "weighings"
          ? weighingRow
          : mortalityRow;
    const parsed = z
      .object({ entity: z.string(), rows: z.array(schema).min(1).max(1000) })
      .safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message, path: parsed.error.issues[0].path },
        { status: 400 },
      );
    }
    const rows = parsed.data.rows as (
      | z.infer<typeof feedRow>
      | z.infer<typeof weighingRow>
      | z.infer<typeof mortalityRow>
    )[];

    const result = await prisma.$transaction(async (tx) => {
      const uniqueBatchNames = [
        ...new Set(rows.map((r) => r.batchName)),
      ];
      const batches = await tx.livestockBatch.findMany({
        where: {
          name: { in: uniqueBatchNames },
          livestock: { workspaceId: ctx.workspaceId },
        },
        select: {
          id: true,
          name: true,
          currentCount: true,
        },
      });
      const byName = new Map(batches.map((b) => [b.name, b]));
      for (const n of uniqueBatchNames) {
        if (!byName.has(n)) {
          throw new ImportError(`Batch "${n}" not found in this workspace`);
        }
      }

      let created = 0;
      // Running mortality tracker — for ordered deduction within the
      // same import call. We don't write currentCount back until the
      // end of each batch to keep the math simple.
      const mortalityDelta = new Map<string, number>();

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const batch = byName.get(r.batchName);
        if (!batch) {
          throw new ImportError(
            `Row ${i + 1}: batch "${r.batchName}" not found`,
          );
        }
        const d = new Date(r.date);
        if (Number.isNaN(d.getTime())) {
          throw new ImportError(`Row ${i + 1}: invalid date "${r.date}"`);
        }
        if (entity === "feed") {
          const f = r as z.infer<typeof feedRow>;
          await tx.feedLog.create({
            data: {
              batchId: batch.id,
              date: d,
              amount: f.amount,
              quantity: f.quantity ?? null,
              unit: f.unit ?? null,
              notes: f.notes ?? null,
              // No linked Transaction here — bulk-importing historical
              // logs typically means the user already booked the
              // expense elsewhere. Live feed logs created via the UI
              // still create txns.
            },
          });
        } else if (entity === "weighings") {
          const w = r as z.infer<typeof weighingRow>;
          await tx.weighingLog.create({
            data: {
              batchId: batch.id,
              date: d,
              phase: w.phase as WeighingPhase,
              sampleSize: w.sampleSize,
              totalKg: w.totalKg,
              avgKg: +(w.totalKg / w.sampleSize).toFixed(3),
              notes: w.notes ?? null,
            },
          });
        } else {
          const m = r as z.infer<typeof mortalityRow>;
          const used = mortalityDelta.get(batch.id) ?? 0;
          const available = batch.currentCount - used;
          if (m.count > available) {
            throw new ImportError(
              `Row ${i + 1}: only ${available} live in "${r.batchName}" after earlier rows in this import`,
            );
          }
          await tx.mortalityLog.create({
            data: {
              batchId: batch.id,
              date: d,
              count: m.count,
              cause: m.cause as MortalityCause,
              culled: m.culled ?? false,
              notes: m.notes ?? null,
            },
          });
          mortalityDelta.set(batch.id, used + m.count);
        }
        created++;
      }

      // Apply mortality decrements once per batch at the end.
      for (const [batchId, delta] of mortalityDelta) {
        await tx.livestockBatch.update({
          where: { id: batchId },
          data: { currentCount: { decrement: delta } },
        });
      }

      return { created };
    });

    return NextResponse.json({ imported: result.created });
  } catch (e) {
    if (e instanceof ImportError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    return err(e);
  }
}
