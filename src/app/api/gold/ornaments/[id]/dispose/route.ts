import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import {
  requireWorkspace,
  WorkspaceAccessError,
  assertWorkspaceContact,
} from "@/lib/workspace";
import { canModifyRecord } from "@/lib/permissions";
import { goldOrnamentDisposeSchema } from "@/lib/validators-domain";
import { round2 } from "@/lib/gold";
import { recomputeGoldInvestment } from "@/lib/gold-rollup";
import { loadFundingSources, resolveGoldCategories } from "@/lib/gold-service";
import {
  GoldDisposalKind,
  GoldForm,
  GoldOrnamentStatus,
  InvestmentAction,
  TransactionType,
} from "@/generated/prisma/client";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[gold/ornaments/[id]/dispose]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

/**
 * Sell an ornament for cash, or gift it away.
 *
 * No day-window edit lock here: a disposal is a NEW event dated when it
 * happened, not a retro-edit of the bill that brought the piece in.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireWorkspace("investments", "write");
    const session = await auth();
    const { id } = await context.params;
    const body = await request.json();
    const parsed = goldOrnamentDisposeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const data = parsed.data;

    const ornament = await prisma.goldOrnament.findUnique({
      where: { id },
      include: {
        acquisition: true,
        boughtForContact: { select: { name: true } },
      },
    });
    if (!ornament || ornament.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!canModifyRecord(session, ornament.acquisition)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (ornament.status !== "HELD") {
      return NextResponse.json(
        { error: "This ornament has already left the portfolio." },
        { status: 409 },
      );
    }
    if (ornament.boughtForContactId) {
      return NextResponse.json(
        {
          error:
            `"${ornament.name}" belongs to ${ornament.boughtForContact?.name ?? "a contact"} — ` +
            `it isn't yours to sell or give away.`,
        },
        { status: 409 },
      );
    }

    await assertWorkspaceContact(ctx.workspaceId, data.contactId);

    const sources = await loadFundingSources(
      session,
      ctx.workspaceId,
      data.accountId ? [data.accountId] : [],
      data.cardId ? [data.cardId] : [],
    );
    if ("error" in sources) {
      return NextResponse.json(
        { error: sources.error.message },
        { status: sources.error.status },
      );
    }

    const { saleCategoryId } = await resolveGoldCategories(ctx.workspaceId);
    const date = new Date(data.date);
    const costBasis = Number(ornament.costBasis);
    const netGrams = Number(ornament.netWeightGrams);

    await prisma.$transaction(async (tx) => {
      let disposalTransactionId: string | null = null;

      if (data.kind === "SOLD") {
        const amount = data.amount!;
        const txn = await tx.transaction.create({
          data: {
            workspaceId: ctx.workspaceId,
            // INCOME, not INVESTMENT/SELL. computeAccountBalance() sums
            // income as type INCOME and expense as EXPENSE or
            // INVESTMENT+BUY — an INVESTMENT/SELL row falls through both
            // and the proceeds would never reach the account.
            type: TransactionType.INCOME,
            amount,
            description: `Gold sold — ${ornament.name}`,
            date,
            categoryId: saleCategoryId,
            accountId:
              data.accountId ??
              (data.cardId
                ? (sources.cardIdToAccountId.get(data.cardId) ?? null)
                : null),
            cardId: data.cardId ?? null,
            // Still tagged to the holding so it shows in the investment's
            // transaction history alongside the BUYs.
            investmentId: ornament.acquisition.investmentId,
            investmentAction: InvestmentAction.SELL,
            investmentQty: netGrams > 0 ? netGrams : null,
            investmentPrice: netGrams > 0 ? round2(amount / netGrams) : null,
            goldForm: GoldForm.ORNAMENT,
            beneficiaryContactId: data.contactId ?? null,
            userId: ctx.userId,
            createdByUserId: ctx.userId,
          },
        });
        disposalTransactionId = txn.id;
      }

      await tx.goldOrnament.update({
        where: { id },
        data: {
          status:
            data.kind === "SOLD"
              ? GoldOrnamentStatus.SOLD
              : GoldOrnamentStatus.GIFTED_OUT,
          disposedAt: date,
          disposalKind:
            data.kind === "SOLD"
              ? GoldDisposalKind.SOLD
              : GoldDisposalKind.GIFTED,
          disposalAmount: data.kind === "SOLD" ? data.amount! : null,
          disposalContactId: data.contactId ?? null,
          disposalTransactionId,
          // Gifting realises nothing — the cost basis simply leaves the
          // portfolio. Deliberate; don't "fix" this into a booked loss.
          realisedGain:
            data.kind === "SOLD" ? round2(data.amount! - costBasis) : null,
          notes: data.notes ?? ornament.notes,
        },
      });

      await recomputeGoldInvestment(tx, ornament.acquisitionId);
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}
