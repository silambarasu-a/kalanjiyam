import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import {
  requireWorkspace,
  WorkspaceAccessError,
  assertWorkspaceContact,
} from "@/lib/workspace";
import { visibilityFilter } from "@/lib/permissions";
import { goldAcquisitionCreateSchema } from "@/lib/validators-domain";
import { round2, round3 } from "@/lib/gold";
import { recomputeGoldInvestment } from "@/lib/gold-rollup";
import {
  computeLines,
  costBasisFor,
  loadFundingSources,
  resolveGoldCategories,
  validateExchangeOrnaments,
  type OrnamentInput,
} from "@/lib/gold-service";
import {
  GoldDisposalKind,
  GoldForm,
  GoldOrnamentStatus,
  InvestmentAction,
  InvestmentKind,
  MemberChargeDirection,
  MemberChargeStatus,
  MemberChargeType,
  Prisma,
  TransactionType,
} from "@/generated/prisma/client";

// The mixed-bill path writes an Investment, N ornaments, N BUY rows and a
// charge+expense+split per on-behalf piece in one transaction.
export const maxDuration = 30;

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  // The acquisition id is the client-minted UUID, so a double submit
  // collides on the primary key instead of creating a second bill.
  if (
    e instanceof Prisma.PrismaClientKnownRequestError &&
    e.code === "P2002"
  ) {
    return NextResponse.json(
      { error: "This bill has already been saved." },
      { status: 409 },
    );
  }
  console.error("[gold/acquisitions]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function GET() {
  try {
    const ctx = await requireWorkspace("investments", "read");
    const session = await auth();
    const acquisitions = await prisma.goldAcquisition.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        ...visibilityFilter(session, ctx.ownOnly),
      },
      orderBy: [{ acquiredAt: "desc" }, { createdAt: "desc" }],
      include: {
        giftedByContact: { select: { id: true, name: true } },
        investment: { select: { id: true, name: true, currentValue: true } },
        _count: { select: { ornaments: true } },
      },
    });

    return NextResponse.json({
      acquisitions: acquisitions.map((a) => ({
        id: a.id,
        kind: a.kind,
        sellerName: a.sellerName,
        billNumber: a.billNumber,
        billTotal: a.billTotal == null ? null : Number(a.billTotal),
        acquiredAt: a.acquiredAt.toISOString(),
        notes: a.notes,
        investmentId: a.investmentId,
        investmentName: a.investment?.name ?? null,
        giftedByContact: a.giftedByContact,
        ornamentCount: a._count.ornaments,
      })),
    });
  } catch (e) {
    return err(e);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireWorkspace("investments", "write");
    const session = await auth();
    const body = await request.json();
    const parsed = goldAcquisitionCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const data = parsed.data;
    const ornaments = data.ornaments as OrnamentInput[];

    // ── Pre-flight: everything that can fail, before anything is written ──

    // Every contact referenced must live in this workspace.
    await assertWorkspaceContact(ctx.workspaceId, data.giftedByContactId);
    for (const sp of data.splits) {
      await assertWorkspaceContact(ctx.workspaceId, sp.contactId);
    }
    for (const o of ornaments) {
      await assertWorkspaceContact(ctx.workspaceId, o.assignedContactId);
      await assertWorkspaceContact(ctx.workspaceId, o.boughtForContactId);
    }

    // Never trust client arithmetic, never silently disagree with the bill.
    const computed = computeLines(ornaments);
    if ("error" in computed) {
      return NextResponse.json(
        { error: computed.error.message },
        { status: computed.error.status },
      );
    }
    const { lines } = computed;

    const sources = await loadFundingSources(
      session,
      ctx.workspaceId,
      [
        ...data.splits.map((s) => s.accountId),
        ...ornaments.map((o) => o.onBehalfAccountId),
      ].filter(Boolean) as string[],
      [
        ...data.splits.map((s) => s.cardId),
        ...ornaments.map((o) => o.onBehalfCardId),
      ].filter(Boolean) as string[],
    );
    if ("error" in sources) {
      return NextResponse.json(
        { error: sources.error.message },
        { status: sources.error.status },
      );
    }
    const { cardIdToAccountId } = sources;

    // Trade-ins that came from our own holdings must still be ours and
    // still held. Untracked scrap has no row to check.
    const tradedIn = await validateExchangeOrnaments(
      ctx.workspaceId,
      data.exchanges
        .map((e) => e.ornamentId)
        .filter(Boolean) as string[],
    );
    if ("error" in tradedIn) {
      return NextResponse.json(
        { error: tradedIn.error.message },
        { status: tradedIn.error.status },
      );
    }
    const tradedById = new Map(tradedIn.ornaments.map((o) => [o.id, o]));

    const { expenseCategoryId } = await resolveGoldCategories(ctx.workspaceId);
    const acquiredAt = new Date(data.acquiredAt);

    // Own lines are what the workspace is keeping; on-behalf lines are
    // someone else's asset funded by a receivable, and never touch the
    // holding's amount or grams.
    const ownIdx = ornaments
      .map((o, i) => (o.boughtForContactId ? -1 : i))
      .filter((i) => i >= 0);
    const investedAmount = round2(
      ownIdx.reduce(
        (a, i) =>
          a + costBasisFor(data.kind, ornaments[i], lines[i].lineTotal),
        0,
      ),
    );
    const investedGrams = round3(
      ownIdx.reduce((a, i) => a + lines[i].netWeightGrams, 0),
    );

    const created = await prisma.$transaction(async (tx) => {
      // A bill whose every line was bought for other people produces no
      // holding at all — but still a bill, its files, and its ornaments.
      const investment = ownIdx.length
        ? await tx.investment.create({
            data: {
              workspaceId: ctx.workspaceId,
              ownerUserId: ctx.userId,
              kind: InvestmentKind.GOLD,
              name: data.name,
              institution: data.sellerName ?? null,
              amount: investedAmount,
              quantity: investedGrams,
              purchasePrice:
                investedAmount > 0 && investedGrams > 0
                  ? round2(investedAmount / investedGrams)
                  : null,
              startedAt: acquiredAt,
              currency: "INR",
              notes: data.notes ?? null,
              metadata: { goldSchema: 2 } as Prisma.InputJsonValue,
            },
          })
        : null;

      const acquisition = await tx.goldAcquisition.create({
        data: {
          // Adopt the client-minted UUID so bill files uploaded against
          // it as drafts resolve the moment this row exists.
          ...(data.clientId ? { id: data.clientId } : {}),
          workspaceId: ctx.workspaceId,
          kind: data.kind,
          investmentId: investment?.id ?? null,
          ownerUserId: ctx.userId,
          sellerName: data.sellerName ?? null,
          billNumber: data.billNumber ?? null,
          billTotal: data.billTotal ?? null,
          acquiredAt,
          giftedByContactId: data.giftedByContactId ?? null,
          notes: data.notes ?? null,
        },
      });

      // One row per piece. A loop rather than createMany because the
      // on-behalf rows need their own id to hang a charge off.
      const ornamentRows = [];
      for (let i = 0; i < ornaments.length; i++) {
        const o = ornaments[i];
        const line = lines[i];
        ornamentRows.push(
          await tx.goldOrnament.create({
            data: {
              workspaceId: ctx.workspaceId,
              acquisitionId: acquisition.id,
              name: o.name,
              itemType: o.itemType ?? null,
              quantity: o.quantity,
              purity: o.purity ?? null,
              grossWeightGrams: o.grossWeightGrams,
              stoneWeightGrams: line.stoneWeightGrams,
              netWeightGrams: line.netWeightGrams,
              ratePerGram: o.ratePerGram,
              wastageAmount: line.wastageAmount,
              wastageInput: o.wastageInput ?? null,
              wastageMode: o.wastageMode,
              makingAmount: line.makingAmount,
              makingInput: o.makingInput ?? null,
              makingMode: o.makingMode,
              stones: o.stones.length
                ? (o.stones as unknown as Prisma.InputJsonValue)
                : Prisma.JsonNull,
              cgstAmount: line.cgstAmount,
              cgstInput: o.cgstInput ?? null,
              cgstMode: o.cgstMode,
              sgstAmount: line.sgstAmount,
              sgstInput: o.sgstInput ?? null,
              sgstMode: o.sgstMode,
              roundOff: line.roundOff,
              lineTotal: line.lineTotal,
              costBasis: costBasisFor(data.kind, o, line.lineTotal),
              declaredValue: o.declaredValue ?? null,
              assignedContactId: o.assignedContactId ?? null,
              boughtForContactId: o.boughtForContactId ?? null,
              notes: o.notes ?? null,
              sortOrder: i,
            },
          }),
        );
      }

      // Tender for the pieces being kept: one BUY per payment row. Gifts
      // and opening stock move no money and so have no splits at all.
      // `investment` is non-null whenever there's tender to post: splits
      // must sum to the own-lines total, and split amounts are positive,
      // so an all-on-behalf bill can't carry any. Checked rather than
      // asserted so a future validator change can't turn this into a crash.
      if (data.kind === "PURCHASE" && data.splits.length > 0 && investment) {
        // A loop rather than createMany because a contact-funded row also
        // raises an obligation that has to point back at its transaction.
        for (let i = 0; i < data.splits.length; i++) {
          const s = data.splits[i];
          const buy = await tx.transaction.create({
            data: {
              workspaceId: ctx.workspaceId,
              type: TransactionType.INVESTMENT,
              amount: s.amount,
              description:
                data.splits.length > 1
                  ? `Gold · ${data.name} (${i + 1}/${data.splits.length})`
                  : `Gold · ${data.name}`,
              date: acquiredAt,
              // A contact paying leaves every balance of ours untouched —
              // that is the whole point of paidByContactId.
              accountId: s.contactId
                ? null
                : (s.accountId ??
                  (s.cardId ? (cardIdToAccountId.get(s.cardId) ?? null) : null)),
              cardId: s.contactId ? null : (s.cardId ?? null),
              paidByContactId: s.contactId ?? null,
              memberChargeType: s.contactId
                ? s.repay
                  ? MemberChargeType.RECOVERABLE
                  : MemberChargeType.GIFT
                : MemberChargeType.NONE,
              investmentId: investment.id,
              investmentAction: InvestmentAction.BUY,
              goldForm: GoldForm.ORNAMENT,
              userId: ctx.userId,
              createdByUserId: ctx.userId,
            },
          });

          if (s.contactId && s.repay) {
            await tx.memberCharge.create({
              data: {
                workspaceId: ctx.workspaceId,
                beneficiaryContactId: s.contactId,
                amount: s.amount,
                status: MemberChargeStatus.OUTSTANDING,
                // They put money in for us, so WE owe THEM — the mirror
                // of the on-behalf ornaments below.
                direction: MemberChargeDirection.USER_OWES,
                sourceTransactionId: buy.id,
                notes: `Gold — ${data.name}`,
              },
            });
          }
        }
      }

      // Each on-behalf piece becomes its own EXPENSE + recoverable split
      // + OWED_TO_USER charge — byte-identical to what /api/transactions
      // produces, which is why the contact statement needs no changes.
      // One charge per physical item, so each settles separately.
      for (let i = 0; i < ornaments.length; i++) {
        const o = ornaments[i];
        if (!o.boughtForContactId) continue;
        const amount = lines[i].lineTotal;
        const contact = await tx.contact.findUnique({
          where: { id: o.boughtForContactId },
          select: { name: true },
        });

        const charge = await tx.memberCharge.create({
          data: {
            workspaceId: ctx.workspaceId,
            beneficiaryContactId: o.boughtForContactId,
            amount,
            status: MemberChargeStatus.OUTSTANDING,
            direction: MemberChargeDirection.OWED_TO_USER,
            notes: `Gold — ${o.name}`,
          },
        });

        const expense = await tx.transaction.create({
          data: {
            workspaceId: ctx.workspaceId,
            type: TransactionType.EXPENSE,
            amount,
            description: `Gold for ${contact?.name ?? "contact"} — ${o.name}`,
            date: acquiredAt,
            categoryId: expenseCategoryId,
            accountId:
              o.onBehalfAccountId ??
              (o.onBehalfCardId
                ? (cardIdToAccountId.get(o.onBehalfCardId) ?? null)
                : null),
            cardId: o.onBehalfCardId ?? null,
            goldForm: GoldForm.ORNAMENT,
            beneficiaryContactId: o.boughtForContactId,
            memberChargeType: MemberChargeType.RECOVERABLE,
            userId: ctx.userId,
            createdByUserId: ctx.userId,
          },
        });

        await tx.transactionSplit.create({
          data: {
            workspaceId: ctx.workspaceId,
            transactionId: expense.id,
            contactId: o.boughtForContactId,
            amount,
            isRecoverable: true,
            memberChargeId: charge.id,
          },
        });

        await tx.goldOrnament.update({
          where: { id: ornamentRows[i].id },
          data: { memberChargeId: charge.id },
        });
      }

      // Old gold handed over. Recorded as a disposal tendered against
      // this bill, not as a discount: the new pieces keep their full
      // cost basis and the old one realises its own gain.
      const touchedAcquisitions = new Set<string>();
      for (let i = 0; i < data.exchanges.length; i++) {
        const e = data.exchanges[i];
        const tracked = e.ornamentId ? tradedById.get(e.ornamentId) : null;

        await tx.goldExchangeItem.create({
          data: {
            workspaceId: ctx.workspaceId,
            acquisitionId: acquisition.id,
            ornamentId: e.ornamentId ?? null,
            name: e.name,
            grossWeightGrams: e.grossWeightGrams,
            purity: e.purity ?? null,
            ratePerGram: e.ratePerGram,
            deductionPercent: e.deductionPercent ?? null,
            creditAmount: e.creditAmount,
            assumedCostBasis: tracked ? 0 : (e.assumedCostBasis ?? 0),
            notes: e.notes ?? null,
            sortOrder: i,
          },
        });

        if (tracked) {
          await tx.goldOrnament.update({
            where: { id: tracked.id },
            data: {
              status: GoldOrnamentStatus.EXCHANGED,
              disposedAt: acquiredAt,
              disposalKind: GoldDisposalKind.EXCHANGED,
              disposalAmount: e.creditAmount,
              // No cash moved and no contact received it — the value
              // went straight into this bill.
              disposalContactId: null,
              realisedGain: round2(
                e.creditAmount - Number(tracked.costBasis),
              ),
            },
          });
          touchedAcquisitions.add(tracked.acquisitionId);
        }
      }

      await recomputeGoldInvestment(tx, acquisition.id);
      // A traded-in piece usually came in on an EARLIER bill, whose
      // holding just lost that weight and basis.
      for (const other of touchedAcquisitions) {
        if (other !== acquisition.id) {
          await recomputeGoldInvestment(tx, other);
        }
      }
      return acquisition;
    });

    return NextResponse.json({ id: created.id });
  } catch (e) {
    return err(e);
  }
}
