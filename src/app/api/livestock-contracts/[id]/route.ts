import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { livestockContractUpdateSchema } from "@/lib/validators-domain";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[livestock-contracts/[id]]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

async function loadContract(id: string, workspaceId: string) {
  const row = await prisma.livestockContract.findUnique({ where: { id } });
  if (!row || row.workspaceId !== workspaceId) return null;
  return row;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireWorkspace("livestock", "read");
    const { id } = await context.params;
    const row = await prisma.livestockContract.findUnique({
      where: { id },
      include: {
        contact: { select: { id: true, name: true } },
        batches: {
          select: {
            id: true,
            name: true,
            active: true,
            currentCount: true,
            startDate: true,
          },
          orderBy: { startDate: "desc" },
        },
      },
    });
    if (!row || row.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Pull every CONTRACT_PAYOUT transaction whose linked batch is one
    // of this contract's batches. Sorted oldest→newest so the chart
    // reads left→right; the sum gives lifetime payout under the
    // contract.
    const batchIds = row.batches.map((b) => b.id);
    const payouts =
      batchIds.length === 0
        ? []
        : await prisma.transaction.findMany({
            where: {
              workspaceId: ctx.workspaceId,
              kind: "CONTRACT_PAYOUT",
              livestockBatchId: { in: batchIds },
            },
            orderBy: { date: "asc" },
            select: {
              id: true,
              date: true,
              amount: true,
              livestockBatchId: true,
            },
          });
    const batchNameById = new Map(row.batches.map((b) => [b.id, b.name]));
    return NextResponse.json({
      contract: {
        id: row.id,
        contactId: row.contactId,
        contactName: row.contact?.name ?? null,
        integratorName: row.integratorName,
        contractRef: row.contractRef,
        agreedRatePerKg: Number(row.agreedRatePerKg),
        fcrBonusBands: row.fcrBonusBands,
        mortalityCap:
          row.mortalityCap == null ? null : Number(row.mortalityCap),
        mortalityPenalty: row.mortalityPenalty,
        suppliesProvided: row.suppliesProvided,
        notes: row.notes,
        startedOn: row.startedOn.toISOString(),
        endedOn: row.endedOn?.toISOString() ?? null,
        batches: row.batches.map((b) => ({
          id: b.id,
          name: b.name,
          active: b.active,
          currentCount: b.currentCount,
          startDate: b.startDate.toISOString(),
        })),
        payouts: payouts.map((p) => ({
          id: p.id,
          date: p.date.toISOString(),
          amount: Number(p.amount),
          batchId: p.livestockBatchId,
          batchName:
            p.livestockBatchId != null
              ? (batchNameById.get(p.livestockBatchId) ?? "(unknown)")
              : "(unknown)",
        })),
        totalPaidOut: payouts.reduce((s, p) => s + Number(p.amount), 0),
      },
    });
  } catch (e) {
    return err(e);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireWorkspace("livestock", "write");
    const { id } = await context.params;
    const existing = await loadContract(id, ctx.workspaceId);
    if (!existing)
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    const body = await request.json();
    const parsed = livestockContractUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const d = parsed.data;
    if (d.contactId) {
      const contact = await prisma.contact.findUnique({
        where: { id: d.contactId },
        select: { workspaceId: true },
      });
      if (!contact || contact.workspaceId !== ctx.workspaceId) {
        return NextResponse.json({ error: "Contact not found" }, { status: 404 });
      }
    }
    await prisma.livestockContract.update({
      where: { id },
      data: {
        contactId:
          d.contactId === undefined
            ? existing.contactId
            : (d.contactId ?? null),
        integratorName: d.integratorName ?? existing.integratorName,
        contractRef:
          d.contractRef === undefined
            ? existing.contractRef
            : (d.contractRef ?? null),
        agreedRatePerKg: d.agreedRatePerKg ?? existing.agreedRatePerKg,
        fcrBonusBands:
          d.fcrBonusBands === undefined
            ? undefined
            : d.fcrBonusBands == null
              ? Prisma.JsonNull
              : (d.fcrBonusBands as Prisma.InputJsonValue),
        mortalityCap:
          d.mortalityCap === undefined
            ? existing.mortalityCap
            : (d.mortalityCap ?? null),
        mortalityPenalty:
          d.mortalityPenalty === undefined
            ? undefined
            : d.mortalityPenalty == null
              ? Prisma.JsonNull
              : (d.mortalityPenalty as Prisma.InputJsonValue),
        suppliesProvided: d.suppliesProvided ?? existing.suppliesProvided,
        notes: d.notes === undefined ? existing.notes : (d.notes ?? null),
        startedOn: d.startedOn ? new Date(d.startedOn) : existing.startedOn,
        endedOn:
          d.endedOn === undefined
            ? existing.endedOn
            : d.endedOn
              ? new Date(d.endedOn)
              : null,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}

/**
 * Refuses to delete a contract that still has linked batches (returns
 * 409). For ended contracts, set `endedOn` instead — keeps the payout
 * history intact on every batch ever grown under it.
 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireWorkspace("livestock", "write");
    const { id } = await context.params;
    const existing = await loadContract(id, ctx.workspaceId);
    if (!existing)
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    const batchCount = await prisma.livestockBatch.count({
      where: { contractId: id },
    });
    if (batchCount > 0) {
      return NextResponse.json(
        {
          error: `Contract is linked to ${batchCount} batch${batchCount === 1 ? "" : "es"} — close it (endedOn) instead.`,
        },
        { status: 409 },
      );
    }
    await prisma.livestockContract.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}
