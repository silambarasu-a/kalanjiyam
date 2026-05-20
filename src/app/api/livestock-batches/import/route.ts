import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { livestockBatchImportSchema } from "@/lib/validators-domain";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[livestock-batches/import]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

/**
 * Bulk-create historical livestock batches. The full import runs inside
 * a single `$transaction` so a single bad row rolls everything back.
 * Caller gets a per-row report so they can fix and retry.
 *
 * Livestock parent matching is name-based (workspace-scoped). When the
 * named parent doesn't exist and `createMissingLivestock` is true the
 * importer auto-creates it. This makes "paste CSV from spreadsheet"
 * actually work — users don't have to pre-create every livestock kind.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireWorkspace("livestock", "write");
    const body = await request.json();
    const parsed = livestockBatchImportSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message, path: parsed.error.issues[0].path },
        { status: 400 },
      );
    }
    const { rows, createMissingLivestock } = parsed.data;

    const result = await prisma.$transaction(async (tx) => {
      // Resolve / create all livestock parents up-front so we touch the
      // table at most once per unique name.
      const uniqueNames = [...new Set(rows.map((r) => r.livestockName))];
      const existing = await tx.livestock.findMany({
        where: {
          workspaceId: ctx.workspaceId,
          name: { in: uniqueNames },
        },
      });
      const byName = new Map(existing.map((l) => [l.name, l.id]));

      const created: { batchId: string; livestockId: string; row: number }[] = [];
      const newLivestock: string[] = [];

      for (const name of uniqueNames) {
        if (byName.has(name)) continue;
        if (!createMissingLivestock) {
          throw new ImportError(
            `Livestock "${name}" doesn't exist. Create it first or enable auto-create.`,
          );
        }
        const l = await tx.livestock.create({
          data: { workspaceId: ctx.workspaceId, name },
        });
        byName.set(name, l.id);
        newLivestock.push(name);
      }

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const livestockId = byName.get(r.livestockName);
        if (!livestockId) {
          throw new ImportError(
            `Row ${i + 1}: couldn't resolve livestock "${r.livestockName}"`,
          );
        }
        const start = new Date(r.startDate);
        if (Number.isNaN(start.getTime())) {
          throw new ImportError(`Row ${i + 1}: invalid startDate "${r.startDate}"`);
        }
        const batch = await tx.livestockBatch.create({
          data: {
            livestockId,
            name: r.batchName,
            productionType: r.productionType ?? "DUAL_PURPOSE",
            startDate: start,
            endDate: r.endDate ? new Date(r.endDate) : null,
            expectedCycleDays: r.expectedCycleDays ?? null,
            initialCount: r.initialCount,
            // Default currentCount to initialCount when caller didn't
            // supply one — same semantics as the New-batch wizard.
            currentCount:
              r.currentCount === undefined ? r.initialCount : r.currentCount,
            initialAvgWeight: r.initialAvgWeight ?? null,
            targetWeight: r.targetWeight ?? null,
            targetFCR: r.targetFCR ?? null,
            notes: r.notes ?? null,
            active: r.active ?? true,
          },
        });
        created.push({
          batchId: batch.id,
          livestockId,
          row: i + 1,
        });
      }

      return { created, newLivestock };
    });

    return NextResponse.json({
      imported: result.created.length,
      newLivestock: result.newLivestock,
      batches: result.created,
    });
  } catch (e) {
    if (e instanceof ImportError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    return err(e);
  }
}

class ImportError extends Error {}
