import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { eventUpdateSchema } from "@/lib/validators-domain";
import { EventKind } from "@/generated/prisma/client";
import { archiveAttachmentsForOwner } from "@/lib/attachment-archive";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[events/[id]]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

/**
 * GET /api/events/[id] — detail view: event row + total spent +
 * per-category breakdown + transactions list + member-charges
 * roll-up (who paid, who owes from this event).
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireWorkspace("events", "read");
    const { id } = await context.params;
    const event = await prisma.event.findUnique({ where: { id } });
    if (!event || event.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const transactions = await prisma.transaction.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        eventId: id,
        transferId: null,
      },
      orderBy: { date: "asc" },
      include: {
        category: {
          select: {
            id: true,
            name: true,
            parentCategoryId: true,
          },
        },
        memberCharge: {
          select: {
            id: true,
            amount: true,
            settledAmount: true,
            status: true,
            beneficiaryContactId: true,
          },
        },
      },
    });

    // Build category labels — pull parent names so we render
    // "Vehicle › Fuel" for child categories.
    const parentIds = Array.from(
      new Set(
        transactions
          .map((t) => t.category?.parentCategoryId)
          .filter((p): p is string => !!p),
      ),
    );
    const parents = parentIds.length
      ? await prisma.category.findMany({
          where: { id: { in: parentIds } },
          select: { id: true, name: true },
        })
      : [];
    const parentNames = new Map(parents.map((p) => [p.id, p.name]));

    // Per-category breakdown, expense only.
    const breakdownMap = new Map<
      string,
      { categoryId: string | null; label: string; total: number }
    >();
    let totalSpent = 0;
    for (const t of transactions) {
      if (t.type !== "EXPENSE") continue;
      const amt = Number(t.amount);
      totalSpent += amt;
      const catId = t.category?.id ?? null;
      const label = t.category
        ? t.category.parentCategoryId
          ? `${parentNames.get(t.category.parentCategoryId) ?? "?"} › ${t.category.name}`
          : t.category.name
        : "Uncategorised";
      const key = catId ?? "__none__";
      const row = breakdownMap.get(key);
      if (row) row.total += amt;
      else breakdownMap.set(key, { categoryId: catId, label, total: amt });
    }
    const breakdown = [...breakdownMap.values()].sort(
      (a, b) => b.total - a.total,
    );

    // Member-splits roll-up — sum unsettled charges per beneficiary.
    type Charge = NonNullable<(typeof transactions)[number]["memberCharge"]>;
    const splitsByContact = new Map<
      string,
      { owes: number; settled: number }
    >();
    const contactIds = new Set<string>();
    for (const t of transactions) {
      const mc: Charge | null = t.memberCharge;
      if (!mc || mc.status === "WRITTEN_OFF") continue;
      contactIds.add(mc.beneficiaryContactId);
      const total = Number(mc.amount);
      const settled = Number(mc.settledAmount);
      const row = splitsByContact.get(mc.beneficiaryContactId) ?? {
        owes: 0,
        settled: 0,
      };
      row.owes += total - settled;
      row.settled += settled;
      splitsByContact.set(mc.beneficiaryContactId, row);
    }
    const contacts = contactIds.size
      ? await prisma.contact.findMany({
          where: { id: { in: [...contactIds] } },
          select: { id: true, name: true },
        })
      : [];
    const contactNames = new Map(contacts.map((c) => [c.id, c.name]));
    const memberSplits = [...splitsByContact.entries()].map(
      ([contactId, v]) => ({
        contactId,
        contactName: contactNames.get(contactId) ?? "(unknown)",
        owes: v.owes,
        settled: v.settled,
      }),
    );

    return NextResponse.json({
      event: {
        id: event.id,
        name: event.name,
        kind: event.kind,
        startedAt: event.startedAt.toISOString(),
        endedAt: event.endedAt?.toISOString() ?? null,
        notes: event.notes,
        budget: event.budget == null ? null : Number(event.budget),
        active: event.active,
      },
      totalSpent,
      breakdown,
      memberSplits,
      transactions: transactions.map((t) => ({
        id: t.id,
        date: t.date.toISOString(),
        type: t.type,
        amount: Number(t.amount),
        description: t.description,
        categoryId: t.category?.id ?? null,
        categoryLabel: t.category
          ? t.category.parentCategoryId
            ? `${parentNames.get(t.category.parentCategoryId) ?? "?"} › ${t.category.name}`
            : t.category.name
          : "Uncategorised",
      })),
    });
  } catch (e) {
    return err(e);
  }
}

/**
 * PATCH /api/events/[id] — edit any field; toggle `active=false` to
 * archive without deleting.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireWorkspace("events", "write");
    const { id } = await context.params;
    const existing = await prisma.event.findUnique({ where: { id } });
    if (!existing || existing.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const body = await request.json();
    const parsed = eventUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const d = parsed.data;
    const updated = await prisma.event.update({
      where: { id },
      data: {
        name: d.name ?? existing.name,
        kind: (d.kind as EventKind | undefined) ?? existing.kind,
        startedAt: d.startedAt ? new Date(d.startedAt) : existing.startedAt,
        endedAt:
          d.endedAt === undefined
            ? existing.endedAt
            : d.endedAt
              ? new Date(d.endedAt)
              : null,
        notes: d.notes === undefined ? existing.notes : d.notes,
        budget: d.budget === undefined ? existing.budget : d.budget,
        active: d.active ?? existing.active,
      },
    });
    return NextResponse.json({ id: updated.id });
  } catch (e) {
    return err(e);
  }
}

/**
 * DELETE /api/events/[id] — refuses with 409 if linked transactions
 * exist (suggests archiving). On clean delete, archives any
 * EVENT_DOCUMENT attachments first.
 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireWorkspace("events", "write");
    const { id } = await context.params;
    const existing = await prisma.event.findUnique({ where: { id } });
    if (!existing || existing.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const txCount = await prisma.transaction.count({ where: { eventId: id } });
    if (txCount > 0) {
      return NextResponse.json(
        {
          error: `This event has ${txCount} linked transaction${txCount === 1 ? "" : "s"}. Archive it instead, or unlink the transactions first.`,
        },
        { status: 409 },
      );
    }
    await prisma.$transaction(async (tx) => {
      await archiveAttachmentsForOwner({
        workspaceId: ctx.workspaceId,
        ownerKind: "EVENT_DOCUMENT",
        ownerId: id,
        userId: ctx.userId,
        tx,
      });
      await tx.event.delete({ where: { id } });
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}
