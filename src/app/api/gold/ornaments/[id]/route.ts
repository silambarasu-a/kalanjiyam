import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import {
  requireWorkspace,
  WorkspaceAccessError,
  assertWorkspaceContact,
} from "@/lib/workspace";
import { canAccessRecord, canModifyRecord } from "@/lib/permissions";
import { goldOrnamentUpdateSchema } from "@/lib/validators-domain";
import { archiveAttachmentsForOwner } from "@/lib/attachment-archive";
import { recomputeGoldInvestment } from "@/lib/gold-rollup";
import {
  blockingSettledCharge,
  ornamentInclude,
  serializeOrnament,
} from "@/lib/gold-service";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[gold/ornaments/[id]]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireWorkspace("investments", "read");
    const session = await auth();
    const { id } = await context.params;

    const ornament = await prisma.goldOrnament.findUnique({
      where: { id },
      include: {
        ...ornamentInclude,
        acquisition: {
          include: {
            giftedByContact: { select: { id: true, name: true } },
            investment: {
              select: { id: true, name: true, currentValue: true },
            },
            // Every sibling on the same bill — this is what makes the
            // bill reachable from any one piece.
            ornaments: {
              orderBy: { sortOrder: "asc" },
              select: {
                id: true,
                name: true,
                netWeightGrams: true,
                purity: true,
                lineTotal: true,
                status: true,
                boughtForContactId: true,
              },
            },
          },
        },
      },
    });
    if (!ornament || ornament.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!canAccessRecord(session, ornament.acquisition)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const acq = ornament.acquisition;
    return NextResponse.json({
      ornament: serializeOrnament(ornament),
      acquisition: {
        id: acq.id,
        kind: acq.kind,
        sellerName: acq.sellerName,
        billNumber: acq.billNumber,
        billTotal: acq.billTotal == null ? null : Number(acq.billTotal),
        acquiredAt: acq.acquiredAt.toISOString(),
        notes: acq.notes,
        investmentId: acq.investmentId,
        investmentName: acq.investment?.name ?? null,
        giftedByContact: acq.giftedByContact,
      },
      siblings: acq.ornaments
        .filter((s) => s.id !== ornament.id)
        .map((s) => ({
          id: s.id,
          name: s.name,
          netWeightGrams: Number(s.netWeightGrams),
          purity: s.purity,
          lineTotal: Number(s.lineTotal),
          status: s.status,
          isTheirs: !!s.boughtForContactId,
        })),
    });
  } catch (e) {
    return err(e);
  }
}

/**
 * Light edits only — the label, who wears it, the declared value, notes.
 * Anything that moves money (weights, rates, charges, who it was bought
 * for) goes through the bill so the tender and the receivable stay in
 * step with the line.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireWorkspace("investments", "write");
    const session = await auth();
    const { id } = await context.params;
    const body = await request.json();
    const parsed = goldOrnamentUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const data = parsed.data;

    const ornament = await prisma.goldOrnament.findUnique({
      where: { id },
      include: { acquisition: true },
    });
    if (!ornament || ornament.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!canModifyRecord(session, ornament.acquisition)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (data.assignedContactId) {
      if (ornament.boughtForContactId) {
        return NextResponse.json(
          {
            error:
              "This ornament was bought for a contact, so it's already theirs — it can't also be assigned to someone.",
          },
          { status: 400 },
        );
      }
      await assertWorkspaceContact(ctx.workspaceId, data.assignedContactId);
    }

    const updated = await prisma.goldOrnament.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.itemType !== undefined ? { itemType: data.itemType } : {}),
        ...(data.assignedContactId !== undefined
          ? { assignedContactId: data.assignedContactId }
          : {}),
        ...(data.declaredValue !== undefined
          ? { declaredValue: data.declaredValue }
          : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
      },
      include: ornamentInclude,
    });

    return NextResponse.json({ ornament: serializeOrnament(updated) });
  } catch (e) {
    return err(e);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireWorkspace("investments", "write");
    const session = await auth();
    const { id } = await context.params;

    const ornament = await prisma.goldOrnament.findUnique({
      where: { id },
      include: { ...ornamentInclude, acquisition: true },
    });
    if (!ornament || ornament.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!canModifyRecord(session, ornament.acquisition)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const settled = blockingSettledCharge([ornament]);
    if (settled) {
      return NextResponse.json(
        { error: settled.message },
        { status: settled.status },
      );
    }
    if (ornament.status !== "HELD") {
      return NextResponse.json(
        {
          error:
            "This ornament has already been sold or gifted away — deleting it would erase that record.",
        },
        { status: 409 },
      );
    }

    const remaining = await prisma.goldOrnament.count({
      where: { acquisitionId: ornament.acquisitionId },
    });
    if (remaining <= 1) {
      return NextResponse.json(
        {
          error:
            "This is the only ornament on the bill. Delete the bill instead.",
        },
        { status: 409 },
      );
    }
    // On a purchase, the payment rows were entered to total the whole
    // bill. Removing a line here would leave them over-allocated — the
    // account would still show money leaving for a piece that no longer
    // exists — so the payments have to be corrected in the same edit.
    if (ornament.acquisition.kind === "PURCHASE") {
      return NextResponse.json(
        {
          error:
            "Remove this ornament from its bill, so the payment rows can be " +
            "corrected at the same time.",
          billId: ornament.acquisitionId,
        },
        { status: 409 },
      );
    }

    await prisma.$transaction(async (tx) => {
      await archiveAttachmentsForOwner({
        workspaceId: ctx.workspaceId,
        ownerKind: "GOLD_ORNAMENT",
        ownerId: ornament.id,
        userId: ctx.userId,
        tx,
      });
      // Charges cascade with the ornament; their expenses don't.
      const chargeIds = ornament.memberCharges.map((c) => c.id);
      if (chargeIds.length) {
        const splits = await tx.transactionSplit.findMany({
          where: { memberChargeId: { in: chargeIds } },
          select: { transactionId: true },
        });
        if (splits.length) {
          await tx.transaction.deleteMany({
            where: { id: { in: splits.map((x) => x.transactionId) } },
          });
        }
      }
      await tx.goldOrnament.delete({ where: { id } });
      await recomputeGoldInvestment(tx, ornament.acquisitionId);
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}
