import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import {
  requireWorkspace,
  WorkspaceAccessError,
  assertWorkspaceContact,
} from "@/lib/workspace";
import { canAccessRecord, canModifyRecord } from "@/lib/permissions";
import { goldAcquisitionUpdateSchema } from "@/lib/validators-domain";
import { checkDayWindowEditAllowed } from "@/lib/transaction-edit-lock";
import {
  archiveAttachmentsForOwner,
  archiveAttachmentsForOwners,
} from "@/lib/attachment-archive";
import { round2 } from "@/lib/gold";
import { recomputeGoldInvestment } from "@/lib/gold-rollup";
import {
  blockingSettledCharge,
  computeLines,
  costBasisFor,
  loadFundingSources,
  ornamentInclude,
  serializeOrnament,
  validateExchangeOrnaments,
  type OrnamentInput,
} from "@/lib/gold-service";
import {
  GoldDisposalKind,
  GoldForm,
  GoldOrnamentStatus,
  InvestmentAction,
  Prisma,
  TransactionType,
} from "@/generated/prisma/client";

/**
 * Put a traded-in ornament back where it was. Used when a bill that
 * consumed it is edited or deleted — otherwise the piece would stay
 * disposed with nothing recording why.
 */
const restoreExchanged = {
  status: GoldOrnamentStatus.HELD,
  disposedAt: null,
  disposalKind: null,
  disposalAmount: null,
  realisedGain: null,
} as const;

export const maxDuration = 30;

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[gold/acquisitions/[id]]", e);
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

    const acq = await prisma.goldAcquisition.findUnique({
      where: { id },
      include: {
        giftedByContact: { select: { id: true, name: true } },
        investment: true,
        ornaments: {
          orderBy: { sortOrder: "asc" },
          include: ornamentInclude,
        },
        exchanges: {
          orderBy: { sortOrder: "asc" },
          include: { ornament: { select: { id: true, name: true } } },
        },
      },
    });
    // 404 rather than 403 on a cross-workspace id — never leak existence.
    if (!acq || acq.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!canAccessRecord(session, acq)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const transactions = acq.investmentId
      ? await prisma.transaction.findMany({
          where: { investmentId: acq.investmentId },
          orderBy: { date: "desc" },
          take: 200,
          select: {
            id: true,
            type: true,
            amount: true,
            description: true,
            date: true,
            accountId: true,
            cardId: true,
            investmentAction: true,
          },
        })
      : [];

    return NextResponse.json({
      acquisition: {
        id: acq.id,
        kind: acq.kind,
        sellerName: acq.sellerName,
        billNumber: acq.billNumber,
        billTotal: acq.billTotal == null ? null : Number(acq.billTotal),
        acquiredAt: acq.acquiredAt.toISOString(),
        notes: acq.notes,
        createdAt: acq.createdAt.toISOString(),
        investmentId: acq.investmentId,
        giftedByContact: acq.giftedByContact,
        investment: acq.investment
          ? {
              id: acq.investment.id,
              name: acq.investment.name,
              amount: Number(acq.investment.amount),
              quantity:
                acq.investment.quantity == null
                  ? null
                  : Number(acq.investment.quantity),
              currentValue:
                acq.investment.currentValue == null
                  ? null
                  : Number(acq.investment.currentValue),
              active: acq.investment.active,
            }
          : null,
      },
      ornaments: acq.ornaments.map(serializeOrnament),
      exchanges: acq.exchanges.map((e) => ({
        id: e.id,
        ornamentId: e.ornamentId,
        ornamentName: e.ornament?.name ?? null,
        name: e.name,
        grossWeightGrams: Number(e.grossWeightGrams),
        purity: e.purity,
        ratePerGram: Number(e.ratePerGram),
        deductionPercent:
          e.deductionPercent == null ? null : Number(e.deductionPercent),
        creditAmount: Number(e.creditAmount),
        assumedCostBasis: Number(e.assumedCostBasis),
        notes: e.notes,
      })),
      transactions: transactions.map((t) => ({
        id: t.id,
        type: t.type,
        amount: Number(t.amount),
        description: t.description,
        date: t.date.toISOString(),
        accountId: t.accountId,
        cardId: t.cardId,
        action: t.investmentAction,
      })),
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
    const ctx = await requireWorkspace("investments", "write");
    const session = await auth();
    const { id } = await context.params;
    const body = await request.json();
    const parsed = goldAcquisitionUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const data = parsed.data;

    const acq = await prisma.goldAcquisition.findUnique({
      where: { id },
      include: {
        ornaments: { include: ornamentInclude },
        exchanges: true,
      },
    });
    if (!acq || acq.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!canModifyRecord(session, acq)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Anchored on createdAt, not acquiredAt — an opening-stock piece can
    // legitimately be dated twenty years ago and would lock instantly.
    const lock = await checkDayWindowEditAllowed({
      date: acq.createdAt,
      workspaceId: ctx.workspaceId,
      role: ctx.role,
      force: data.force === true,
      entityName: "gold bill",
    });
    if (!lock.ok) {
      return NextResponse.json({ error: lock.message }, { status: lock.status });
    }

    // Refuse before touching anything: money already settled against a
    // piece, or a piece that has left the portfolio.
    const settled = blockingSettledCharge(acq.ornaments);
    if (settled) {
      return NextResponse.json(
        { error: settled.message },
        { status: settled.status },
      );
    }
    const disposed = acq.ornaments.find((o) => o.status !== "HELD");
    if (disposed) {
      return NextResponse.json(
        {
          error:
            `"${disposed.name}" has already been sold or gifted away. ` +
            `Edit disposed pieces individually.`,
        },
        { status: 409 },
      );
    }

    const kind = data.kind ?? acq.kind;
    const acquiredAt = data.acquiredAt
      ? new Date(data.acquiredAt)
      : acq.acquiredAt;

    // Ornaments are replaced wholesale only when the payload includes
    // them; otherwise this is a header-only edit.
    if (!data.ornaments) {
      const updated = await prisma.goldAcquisition.update({
        where: { id },
        data: {
          kind,
          sellerName: data.sellerName ?? acq.sellerName,
          billNumber: data.billNumber ?? acq.billNumber,
          billTotal: data.billTotal ?? acq.billTotal,
          acquiredAt,
          notes: data.notes ?? acq.notes,
        },
      });
      return NextResponse.json({ id: updated.id });
    }

    const ornaments = data.ornaments as OrnamentInput[];

    await assertWorkspaceContact(ctx.workspaceId, data.giftedByContactId);
    for (const o of ornaments) {
      await assertWorkspaceContact(ctx.workspaceId, o.assignedContactId);
      await assertWorkspaceContact(ctx.workspaceId, o.boughtForContactId);
    }

    const computed = computeLines(ornaments);
    if ("error" in computed) {
      return NextResponse.json(
        { error: computed.error.message },
        { status: computed.error.status },
      );
    }
    const { lines } = computed;

    // .partial() drops the create schema's refinements, so the sum checks
    // are re-run here by hand — same arrangement as investmentUpdate.
    const splits = data.splits ?? [];
    // Omitting `exchanges` on a PATCH means "no trade-ins", same as
    // omitting `splits` means "no payments" — both are replaced wholesale.
    const exchanges = data.exchanges ?? [];
    const ownTotal = round2(
      ornaments.reduce(
        (a, o, i) => (o.boughtForContactId ? a : a + lines[i].lineTotal),
        0,
      ),
    );
    const exchangeCredit = round2(
      exchanges.reduce((a, e) => a + e.creditAmount, 0),
    );
    if (kind === "PURCHASE") {
      const tender = round2(splits.reduce((a, s) => a + s.amount, 0));
      if (Math.abs(tender + exchangeCredit - ownTotal) > 0.01) {
        return NextResponse.json(
          {
            error:
              `Payments (₹${tender.toFixed(2)}) plus the old-gold credit ` +
              `(₹${exchangeCredit.toFixed(2)}) come to ₹${(tender + exchangeCredit).toFixed(2)}, ` +
              `but the ornaments you're keeping total ₹${ownTotal.toFixed(2)}.`,
          },
          { status: 400 },
        );
      }
    } else if (splits.length > 0 || exchanges.length > 0) {
      return NextResponse.json(
        { error: "Gifts and opening stock have no payment or trade-in" },
        { status: 400 },
      );
    }

    const tradedIn = await validateExchangeOrnaments(
      ctx.workspaceId,
      exchanges
        .map((e) => e.ornamentId)
        .filter(
          (oid): oid is string =>
            // A piece this same bill already consumed is legitimately not
            // HELD right now; it's released below before being re-taken.
            !!oid && !acq.exchanges.some((x) => x.ornamentId === oid),
        ),
    );
    if ("error" in tradedIn) {
      return NextResponse.json(
        { error: tradedIn.error.message },
        { status: tradedIn.error.status },
      );
    }

    const sources = await loadFundingSources(
      session,
      ctx.workspaceId,
      [
        ...splits.map((s) => s.accountId),
        ...ornaments.map((o) => o.onBehalfAccountId),
      ].filter(Boolean) as string[],
      [
        ...splits.map((s) => s.cardId),
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

    // Rows the payload dropped. Their files are archived outside the
    // transaction body's control, so collect them first.
    const keptIds = new Set(
      ornaments.map((o) => o.id).filter(Boolean) as string[],
    );
    const removed = acq.ornaments.filter((o) => !keptIds.has(o.id));

    await prisma.$transaction(async (tx) => {
      for (const gone of removed) {
        await archiveAttachmentsForOwner({
          workspaceId: ctx.workspaceId,
          ownerKind: "GOLD_ORNAMENT",
          ownerId: gone.id,
          userId: ctx.userId,
          tx,
        });
        if (gone.memberChargeId) {
          // Clear the FK first so deleting the charge can't null the
          // ornament we're about to remove out from under us.
          await tx.goldOrnament.update({
            where: { id: gone.id },
            data: { memberChargeId: null },
          });
          const split = await tx.transactionSplit.findFirst({
            where: { memberChargeId: gone.memberChargeId },
            select: { transactionId: true },
          });
          if (split) {
            // Deleting the expense cascades its split.
            await tx.transaction.delete({ where: { id: split.transactionId } });
          }
          await tx.memberCharge.delete({ where: { id: gone.memberChargeId } });
        }
        await tx.goldOrnament.delete({ where: { id: gone.id } });
      }

      await tx.goldAcquisition.update({
        where: { id },
        data: {
          kind,
          sellerName: data.sellerName ?? acq.sellerName,
          billNumber: data.billNumber ?? acq.billNumber,
          billTotal: data.billTotal ?? acq.billTotal,
          acquiredAt,
          giftedByContactId:
            data.giftedByContactId ?? acq.giftedByContactId,
          notes: data.notes ?? acq.notes,
        },
      });

      // Diff-apply by id — unlike GoldLoanItem's delete-all-and-recreate,
      // ornaments carry their own attachments and charges, so their ids
      // have to survive an edit.
      for (let i = 0; i < ornaments.length; i++) {
        const o = ornaments[i];
        const line = lines[i];
        const fields = {
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
          costBasis: costBasisFor(kind, o, line.lineTotal),
          declaredValue: o.declaredValue ?? null,
          assignedContactId: o.assignedContactId ?? null,
          boughtForContactId: o.boughtForContactId ?? null,
          notes: o.notes ?? null,
          sortOrder: i,
        };

        const existing = o.id
          ? acq.ornaments.find((row) => row.id === o.id)
          : undefined;

        const ornamentId = existing
          ? (
              await tx.goldOrnament.update({
                where: { id: existing.id },
                data: fields,
              })
            ).id
          : (
              await tx.goldOrnament.create({
                data: {
                  workspaceId: ctx.workspaceId,
                  acquisitionId: id,
                  ...fields,
                },
              })
            ).id;

        // Keep the receivable in step with the line. Every charge here is
        // untouched-OUTSTANDING (guarded above), so rewriting it is safe.
        const hadCharge = existing?.memberChargeId ?? null;
        if (o.boughtForContactId) {
          const amount = line.lineTotal;
          const contact = await tx.contact.findUnique({
            where: { id: o.boughtForContactId },
            select: { name: true },
          });
          const accountId =
            o.onBehalfAccountId ??
            (o.onBehalfCardId
              ? (cardIdToAccountId.get(o.onBehalfCardId) ?? null)
              : null);

          if (hadCharge) {
            await tx.memberCharge.update({
              where: { id: hadCharge },
              data: {
                beneficiaryContactId: o.boughtForContactId,
                amount,
                notes: `Gold — ${o.name}`,
              },
            });
            const split = await tx.transactionSplit.findFirst({
              where: { memberChargeId: hadCharge },
              select: { id: true, transactionId: true },
            });
            if (split) {
              await tx.transaction.update({
                where: { id: split.transactionId },
                data: {
                  amount,
                  description: `Gold for ${contact?.name ?? "contact"} — ${o.name}`,
                  date: acquiredAt,
                  accountId,
                  cardId: o.onBehalfCardId ?? null,
                  beneficiaryContactId: o.boughtForContactId,
                },
              });
              await tx.transactionSplit.update({
                where: { id: split.id },
                data: { contactId: o.boughtForContactId, amount },
              });
            }
          } else {
            const charge = await tx.memberCharge.create({
              data: {
                workspaceId: ctx.workspaceId,
                beneficiaryContactId: o.boughtForContactId,
                amount,
                direction: "OWED_TO_USER",
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
                accountId,
                cardId: o.onBehalfCardId ?? null,
                goldForm: GoldForm.ORNAMENT,
                beneficiaryContactId: o.boughtForContactId,
                memberChargeType: "RECOVERABLE",
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
              where: { id: ornamentId },
              data: { memberChargeId: charge.id },
            });
          }
        } else if (hadCharge) {
          // The piece stopped being someone else's — retire its receivable.
          await tx.goldOrnament.update({
            where: { id: ornamentId },
            data: { memberChargeId: null },
          });
          const split = await tx.transactionSplit.findFirst({
            where: { memberChargeId: hadCharge },
            select: { transactionId: true },
          });
          if (split) {
            await tx.transaction.delete({ where: { id: split.transactionId } });
          }
          await tx.memberCharge.delete({ where: { id: hadCharge } });
        }
      }

      // A bill's BUY rows ARE its tender, so replacing them wholesale is
      // safe here — unlike the generic investment PATCH, nothing else
      // posts BUYs against a gold acquisition's holding.
      if (acq.investmentId) {
        await tx.transaction.deleteMany({
          where: { investmentId: acq.investmentId, investmentAction: "BUY" },
        });
      }
      if (kind === "PURCHASE" && splits.length > 0 && acq.investmentId) {
        await tx.transaction.createMany({
          data: splits.map((s, i) => ({
            workspaceId: ctx.workspaceId,
            type: TransactionType.INVESTMENT,
            amount: s.amount,
            description:
              splits.length > 1
                ? `Gold · ${data.name ?? acq.sellerName ?? "bill"} (${i + 1}/${splits.length})`
                : `Gold · ${data.name ?? acq.sellerName ?? "bill"}`,
            date: acquiredAt,
            accountId:
              s.accountId ??
              (s.cardId ? (cardIdToAccountId.get(s.cardId) ?? null) : null),
            cardId: s.cardId ?? null,
            investmentId: acq.investmentId,
            investmentAction: InvestmentAction.BUY,
            goldForm: GoldForm.ORNAMENT,
            userId: ctx.userId,
            createdByUserId: ctx.userId,
          })),
        });
      }

      if (acq.investmentId && data.name) {
        await tx.investment.update({
          where: { id: acq.investmentId },
          data: { name: data.name, startedAt: acquiredAt },
        });
      }

      // Trade-ins are replaced wholesale: release every piece this bill
      // had taken, drop the rows, then re-take what the payload lists.
      // Safe to do bluntly here — exchange rows carry no attachments and
      // no receivables, unlike ornaments.
      const touchedAcquisitions = new Set<string>();
      const releasedIds = acq.exchanges
        .map((e) => e.ornamentId)
        .filter(Boolean) as string[];
      if (releasedIds.length) {
        const released = await tx.goldOrnament.findMany({
          where: { id: { in: releasedIds } },
          select: { id: true, acquisitionId: true },
        });
        released.forEach((r) => touchedAcquisitions.add(r.acquisitionId));
        await tx.goldOrnament.updateMany({
          where: { id: { in: releasedIds } },
          data: restoreExchanged,
        });
      }
      await tx.goldExchangeItem.deleteMany({ where: { acquisitionId: id } });

      for (let i = 0; i < exchanges.length; i++) {
        const e = exchanges[i];
        const tracked = e.ornamentId
          ? await tx.goldOrnament.findUnique({
              where: { id: e.ornamentId },
              select: { costBasis: true, acquisitionId: true },
            })
          : null;

        await tx.goldExchangeItem.create({
          data: {
            workspaceId: ctx.workspaceId,
            acquisitionId: id,
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

        if (e.ornamentId && tracked) {
          await tx.goldOrnament.update({
            where: { id: e.ornamentId },
            data: {
              status: GoldOrnamentStatus.EXCHANGED,
              disposedAt: acquiredAt,
              disposalKind: GoldDisposalKind.EXCHANGED,
              disposalAmount: e.creditAmount,
              disposalContactId: null,
              realisedGain: round2(
                e.creditAmount - Number(tracked.costBasis),
              ),
            },
          });
          touchedAcquisitions.add(tracked.acquisitionId);
        }
      }

      await recomputeGoldInvestment(tx, id);
      for (const other of touchedAcquisitions) {
        if (other !== id) await recomputeGoldInvestment(tx, other);
      }
    });

    return NextResponse.json({ id });
  } catch (e) {
    return err(e);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireWorkspace("investments", "write");
    const session = await auth();
    const { id } = await context.params;
    const force = new URL(request.url).searchParams.get("force") === "1";

    const acq = await prisma.goldAcquisition.findUnique({
      where: { id },
      include: {
        ornaments: { include: ornamentInclude },
        exchanges: true,
      },
    });
    if (!acq || acq.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!canModifyRecord(session, acq)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const lock = await checkDayWindowEditAllowed({
      date: acq.createdAt,
      workspaceId: ctx.workspaceId,
      role: ctx.role,
      force,
      entityName: "gold bill",
    });
    if (!lock.ok) {
      return NextResponse.json({ error: lock.message }, { status: lock.status });
    }

    const settled = blockingSettledCharge(acq.ornaments);
    if (settled) {
      return NextResponse.json(
        { error: settled.message },
        { status: settled.status },
      );
    }

    await prisma.$transaction(async (tx) => {
      // Give back anything this bill took in exchange — otherwise those
      // pieces stay disposed with no record of what consumed them.
      const releasedIds = acq.exchanges
        .map((e) => e.ornamentId)
        .filter(Boolean) as string[];
      const releasedAcquisitions = new Set<string>();
      if (releasedIds.length) {
        const released = await tx.goldOrnament.findMany({
          where: { id: { in: releasedIds } },
          select: { id: true, acquisitionId: true },
        });
        released.forEach((r) => releasedAcquisitions.add(r.acquisitionId));
        await tx.goldOrnament.updateMany({
          where: { id: { in: releasedIds } },
          data: restoreExchanged,
        });
      }

      await archiveAttachmentsForOwners({
        workspaceId: ctx.workspaceId,
        ownerKind: "GOLD_ORNAMENT",
        ownerIds: acq.ornaments.map((o) => o.id),
        userId: ctx.userId,
        tx,
      });
      await archiveAttachmentsForOwner({
        workspaceId: ctx.workspaceId,
        ownerKind: "GOLD_BILL",
        ownerId: acq.id,
        userId: ctx.userId,
        tx,
      });

      const chargeIds = acq.ornaments
        .map((o) => o.memberChargeId)
        .filter(Boolean) as string[];
      if (chargeIds.length) {
        // Break the ornament→charge FK before the charges go, so the
        // cascade order can't trip over SetNull.
        await tx.goldOrnament.updateMany({
          where: { acquisitionId: id },
          data: { memberChargeId: null },
        });
        const splits = await tx.transactionSplit.findMany({
          where: { memberChargeId: { in: chargeIds } },
          select: { transactionId: true },
        });
        if (splits.length) {
          await tx.transaction.deleteMany({
            where: { id: { in: splits.map((s) => s.transactionId) } },
          });
        }
        await tx.memberCharge.deleteMany({ where: { id: { in: chargeIds } } });
      }

      if (acq.investmentId) {
        await tx.transaction.deleteMany({
          where: { investmentId: acq.investmentId },
        });
      }
      // Ornaments and exchange rows cascade with the acquisition.
      await tx.goldAcquisition.delete({ where: { id } });
      if (acq.investmentId) {
        await tx.investment.delete({ where: { id: acq.investmentId } });
      }
      // The bills those released pieces came in on just got them back.
      for (const other of releasedAcquisitions) {
        if (other !== id) await recomputeGoldInvestment(tx, other);
      }
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}
