import { NextResponse } from "next/server";
import { ReminderKind } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { vaccinationLogUpdateSchema } from "@/lib/validators-domain";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[vaccination/[id]]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

async function loadVaccination(
  batchId: string,
  vaccinationId: string,
  workspaceId: string,
) {
  const row = await prisma.vaccinationLog.findUnique({
    where: { id: vaccinationId },
    include: {
      batch: {
        select: { id: true, livestock: { select: { workspaceId: true } } },
      },
    },
  });
  if (
    !row ||
    row.batchId !== batchId ||
    row.batch.livestock.workspaceId !== workspaceId
  ) {
    return null;
  }
  return row;
}

/**
 * Edit a vaccination log. We don't touch the linked Transaction here
 * (same rule as milk/egg/health — re-pricing means delete + recreate),
 * but we DO keep the reminder row in step with `nextDueDate`. The
 * reminder is the cron's only signal for "vaccination is due", so a
 * stale due date silently swallows notifications.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; vaccinationId: string }> },
) {
  try {
    const ctx = await requireWorkspace("livestock", "write");
    const { id, vaccinationId } = await context.params;
    const existing = await loadVaccination(id, vaccinationId, ctx.workspaceId);
    if (!existing)
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    const body = await request.json();
    const parsed = vaccinationLogUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const d = parsed.data;
    const wantsNextDueChange = d.nextDueDate !== undefined;
    const newNextDue: Date | null =
      d.nextDueDate === undefined
        ? existing.nextDueDate
        : d.nextDueDate
          ? new Date(d.nextDueDate)
          : null;

    await prisma.$transaction(async (tx) => {
      await tx.vaccinationLog.update({
        where: { id: vaccinationId },
        data: {
          vaccine: d.vaccine ?? existing.vaccine,
          date: d.date ? new Date(d.date) : existing.date,
          nextDueDate: newNextDue,
          notes: d.notes === undefined ? existing.notes : (d.notes ?? null),
        },
      });

      if (!wantsNextDueChange) return;
      // Sync the linked reminder. Find the UPCOMING one tied to this
      // vaccination — there should be at most one.
      const existingReminder = await tx.investmentReminder.findFirst({
        where: { vaccinationLogId: vaccinationId, status: "UPCOMING" },
        select: { id: true },
      });
      if (newNextDue) {
        if (existingReminder) {
          await tx.investmentReminder.update({
            where: { id: existingReminder.id },
            data: { dueDate: newNextDue },
          });
        } else {
          await tx.investmentReminder.create({
            data: {
              workspaceId: ctx.workspaceId,
              kind: ReminderKind.VACCINATION_DUE,
              dueDate: newNextDue,
              vaccinationLogId: vaccinationId,
            },
          });
        }
      } else if (existingReminder) {
        // nextDueDate cleared → reminder no longer applicable.
        await tx.investmentReminder.delete({
          where: { id: existingReminder.id },
        });
      }
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}

/**
 * Delete a vaccination log. Cascades:
 *   - the linked EXPENSE Transaction (if any) is deleted too,
 *   - any UPCOMING reminder is removed (the schema's CASCADE handles
 *     this automatically via the FK, but we delete explicitly for the
 *     `confirmed` reminders that don't cascade).
 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; vaccinationId: string }> },
) {
  try {
    const ctx = await requireWorkspace("livestock", "write");
    const { id, vaccinationId } = await context.params;
    const existing = await loadVaccination(id, vaccinationId, ctx.workspaceId);
    if (!existing)
      return NextResponse.json({ error: "Not found" }, { status: 404 });

    await prisma.$transaction(async (tx) => {
      // Reminders FK-cascade on delete; we explicitly delete txn first
      // so cashflow stays consistent with production.
      if (existing.transactionId) {
        await tx.transaction.delete({
          where: { id: existing.transactionId },
        });
      }
      await tx.vaccinationLog.delete({ where: { id: vaccinationId } });
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}
