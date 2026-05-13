import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  requireWorkspace,
  WorkspaceAccessError,
  assertWorkspaceContact,
} from "@/lib/workspace";
import {
  TransactionType,
  VehicleDisposalKind,
} from "@/generated/prisma/client";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[vehicles/dispose]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

const disposeSchema = z
  .object({
    kind: z.enum(["SOLD", "EXCHANGED", "SCRAPPED", "GIFTED", "TOTAL_LOSS"]),
    date: z.string(),
    amount: z.number().nonnegative().optional().nullable(),
    /** Buyer (for SOLD) or recipient (for GIFTED). Optional otherwise. */
    buyerContactId: z.string().uuid().optional().nullable(),
    /** For EXCHANGED: the new vehicle that replaces this one. */
    replacedById: z.string().uuid().optional().nullable(),
    /** Optional: account/card to credit when amount > 0. When omitted, no
     * transaction is created — the disposal just marks the vehicle and
     * lets the user log the inflow separately. */
    accountId: z.string().uuid().optional().nullable(),
    cardId: z.string().uuid().optional().nullable(),
    notes: z.string().trim().max(500).optional(),
  })
  .refine((d) => !(d.accountId && d.cardId), {
    message: "Pick either an account or a card, not both",
    path: ["accountId"],
  });

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireWorkspace("vehicles", "write");
    const { id } = await context.params;
    const vehicle = await prisma.vehicle.findUnique({ where: { id } });
    if (!vehicle || vehicle.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (vehicle.disposedAt) {
      return NextResponse.json(
        { error: "This vehicle is already marked as disposed" },
        { status: 409 },
      );
    }

    const body = await request.json();
    const parsed = disposeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const data = parsed.data;

    if (data.buyerContactId) {
      await assertWorkspaceContact(ctx.workspaceId, data.buyerContactId);
    }
    if (data.replacedById) {
      const replacement = await prisma.vehicle.findUnique({
        where: { id: data.replacedById },
        select: { workspaceId: true, id: true },
      });
      if (!replacement || replacement.workspaceId !== ctx.workspaceId) {
        return NextResponse.json(
          { error: "Replacement vehicle not found" },
          { status: 400 },
        );
      }
    }

    // Resolve the Vehicle Sale category once. Used as the categoryId on
    // the auto-created income transaction. Falls back to undefined if the
    // workspace has somehow lost the default — the txn still works, it
    // just shows up uncategorised.
    const saleCategory = await prisma.category.findFirst({
      where: {
        name: "Vehicle Sale",
        OR: [{ workspaceId: ctx.workspaceId }, { workspaceId: null, isDefault: true }],
        types: { has: "INCOME" },
      },
      select: { id: true },
    });

    // Resolve the card's companion account so the txn lands on the right
    // ledger (matches /api/transactions card-routing pattern).
    let resolvedAccountId: string | null = data.accountId ?? null;
    if (data.cardId) {
      const card = await prisma.card.findUnique({
        where: { id: data.cardId },
        select: { workspaceId: true, accountId: true },
      });
      if (!card || card.workspaceId !== ctx.workspaceId) {
        return NextResponse.json({ error: "Card not found" }, { status: 404 });
      }
      resolvedAccountId = card.accountId ?? resolvedAccountId;
    }
    if (data.accountId) {
      const acct = await prisma.account.findUnique({
        where: { id: data.accountId },
        select: { workspaceId: true },
      });
      if (!acct || acct.workspaceId !== ctx.workspaceId) {
        return NextResponse.json({ error: "Account not found" }, { status: 404 });
      }
    }

    const disposedAt = new Date(data.date);
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.vehicle.update({
        where: { id },
        data: {
          disposedAt,
          disposalKind: data.kind as VehicleDisposalKind,
          disposalAmount: data.amount ?? null,
          disposalContactId: data.buyerContactId ?? null,
          replacedById: data.replacedById ?? null,
          active: false,
          notes:
            data.notes && data.notes.trim()
              ? [vehicle.notes, `[Disposed] ${data.notes.trim()}`]
                  .filter(Boolean)
                  .join("\n")
              : vehicle.notes,
        },
      });

      // Auto-create the income transaction when the user supplied an
      // amount + a destination account/card. Tagged to this vehicle and
      // (when SOLD/GIFTED) to the buyer as beneficiary so the contact's
      // ledger surfaces the inflow too. SCRAPPED / TOTAL_LOSS with amount
      // = scrap value or insurance payout still goes through this path.
      let txnId: string | null = null;
      if (data.amount && data.amount > 0 && resolvedAccountId) {
        const labelKind = data.kind.toLowerCase().replace("_", " ");
        const txn = await tx.transaction.create({
          data: {
            workspaceId: ctx.workspaceId,
            type: TransactionType.INCOME,
            amount: data.amount,
            description: `Vehicle ${labelKind} — ${vehicle.name}`,
            date: disposedAt,
            categoryId: saleCategory?.id ?? null,
            accountId: resolvedAccountId,
            cardId: data.cardId ?? null,
            beneficiaryContactId: data.buyerContactId ?? null,
            vehicleId: id,
            userId: ctx.userId,
            createdByUserId: ctx.userId,
          },
          select: { id: true },
        });
        txnId = txn.id;
      }

      return { vehicleId: updated.id, transactionId: txnId };
    });

    return NextResponse.json(result);
  } catch (e) {
    return err(e);
  }
}
