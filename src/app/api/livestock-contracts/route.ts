import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { livestockContractCreateSchema } from "@/lib/validators-domain";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[livestock-contracts]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function GET() {
  try {
    const ctx = await requireWorkspace("livestock", "read");
    const rows = await prisma.livestockContract.findMany({
      where: { workspaceId: ctx.workspaceId },
      orderBy: { startedOn: "desc" },
      include: {
        contact: { select: { id: true, name: true } },
        _count: { select: { batches: true } },
      },
    });
    return NextResponse.json({
      contracts: rows.map((r) => ({
        id: r.id,
        contactId: r.contactId,
        contactName: r.contact?.name ?? null,
        integratorName: r.integratorName,
        contractRef: r.contractRef,
        agreedRatePerKg: Number(r.agreedRatePerKg),
        fcrBonusBands: r.fcrBonusBands,
        mortalityCap: r.mortalityCap == null ? null : Number(r.mortalityCap),
        mortalityPenalty: r.mortalityPenalty,
        suppliesProvided: r.suppliesProvided,
        notes: r.notes,
        startedOn: r.startedOn.toISOString(),
        endedOn: r.endedOn?.toISOString() ?? null,
        batchCount: r._count.batches,
      })),
    });
  } catch (e) {
    return err(e);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireWorkspace("livestock", "write");
    const body = await request.json();
    const parsed = livestockContractCreateSchema.safeParse(body);
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
    const row = await prisma.livestockContract.create({
      data: {
        workspaceId: ctx.workspaceId,
        contactId: d.contactId ?? null,
        integratorName: d.integratorName,
        contractRef: d.contractRef ?? null,
        agreedRatePerKg: d.agreedRatePerKg,
        fcrBonusBands:
          d.fcrBonusBands == null
            ? Prisma.JsonNull
            : (d.fcrBonusBands as Prisma.InputJsonValue),
        mortalityCap: d.mortalityCap ?? null,
        mortalityPenalty:
          d.mortalityPenalty == null
            ? Prisma.JsonNull
            : (d.mortalityPenalty as Prisma.InputJsonValue),
        suppliesProvided: d.suppliesProvided ?? [],
        notes: d.notes ?? null,
        startedOn: new Date(d.startedOn),
        endedOn: d.endedOn ? new Date(d.endedOn) : null,
      },
    });
    return NextResponse.json({ id: row.id });
  } catch (e) {
    return err(e);
  }
}
