import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { canAccessRecord, canModifyRecord } from "@/lib/permissions";
import { investmentUpdateSchema } from "@/lib/validators-domain";
import { checkDayWindowEditAllowed } from "@/lib/transaction-edit-lock";
import {
  TransactionType,
  InvestmentAction,
  ReminderKind,
  ReminderStatus,
  Prisma,
} from "@/generated/prisma/client";
import {
  computeReminderSchedule,
  policyReminderCount,
  type PremiumFrequency,
} from "@/lib/reminder-schedule";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireWorkspace("investments", "read");
    const session = await auth();
    const { id } = await context.params;
    const inv = await prisma.investment.findUnique({
      where: { id },
      include: {
        renewedFrom: {
          select: {
            id: true,
            name: true,
            policyNumber: true,
            insuranceStatus: true,
            startedAt: true,
            nextDueDate: true,
          },
        },
        successors: {
          select: {
            id: true,
            name: true,
            policyNumber: true,
            insuranceStatus: true,
            startedAt: true,
            nextDueDate: true,
          },
          orderBy: { startedAt: "asc" },
        },
      },
    });
    if (!inv || inv.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!canAccessRecord(session, inv)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const [transactions, reminders] = await Promise.all([
      prisma.transaction.findMany({
        where: { investmentId: id },
        orderBy: { date: "desc" },
        take: 200,
        include: {
          account: { select: { id: true, name: true, kind: true } },
          user: { select: { id: true, name: true } },
        },
      }),
      prisma.investmentReminder.findMany({
        where: { investmentId: id },
        orderBy: { dueDate: "asc" },
        // Long-pay insurance can have hundreds of reminders (20y monthly
        // = 240). Hard cap is the schema-side seed cap of 600.
        take: 600,
      }),
    ]);
    return NextResponse.json({
      investment: {
        id: inv.id,
        kind: inv.kind,
        name: inv.name,
        institution: inv.institution,
        amount: Number(inv.amount),
        currentValue: inv.currentValue == null ? null : Number(inv.currentValue),
        interestRate: inv.interestRate == null ? null : Number(inv.interestRate),
        startedAt: inv.startedAt.toISOString(),
        maturityAt: inv.maturityAt?.toISOString() ?? null,
        active: inv.active,
        notes: inv.notes,
        symbol: inv.symbol,
        quantity: inv.quantity == null ? null : Number(inv.quantity),
        purchasePrice: inv.purchasePrice == null ? null : Number(inv.purchasePrice),
        purchaseExchangeRate:
          inv.purchaseExchangeRate == null ? null : Number(inv.purchaseExchangeRate),
        dividends: inv.dividends == null ? null : Number(inv.dividends),
        exchange: inv.exchange,
        currency: inv.currency,
        policyNumber: inv.policyNumber,
        policyType: inv.policyType,
        premiumAmount: inv.premiumAmount == null ? null : Number(inv.premiumAmount),
        premiumFrequency: inv.premiumFrequency,
        sumAssured: inv.sumAssured == null ? null : Number(inv.sumAssured),
        nextDueDate: inv.nextDueDate?.toISOString() ?? null,
        nominee: inv.nominee,
        insuranceStatus: inv.insuranceStatus,
        fdStatus: inv.fdStatus,
        compoundingFrequency: inv.compoundingFrequency,
        metadata: inv.metadata ?? null,
        policyTermYears: inv.policyTermYears ?? null,
        premiumPayingTermYears: inv.premiumPayingTermYears ?? null,
        maturityValue: inv.maturityValue == null ? null : Number(inv.maturityValue),
        bonusAccrued: inv.bonusAccrued == null ? null : Number(inv.bonusAccrued),
        bonusLastRevisedAt: inv.bonusLastRevisedAt?.toISOString() ?? null,
        ridersJson: inv.ridersJson ?? null,
        renewedFromInvestmentId: inv.renewedFromInvestmentId ?? null,
        renewedFrom: inv.renewedFrom
          ? {
              id: inv.renewedFrom.id,
              name: inv.renewedFrom.name,
              policyNumber: inv.renewedFrom.policyNumber,
              insuranceStatus: inv.renewedFrom.insuranceStatus,
              startedAt: inv.renewedFrom.startedAt.toISOString(),
              nextDueDate: inv.renewedFrom.nextDueDate?.toISOString() ?? null,
            }
          : null,
        successors: inv.successors.map((s) => ({
          id: s.id,
          name: s.name,
          policyNumber: s.policyNumber,
          insuranceStatus: s.insuranceStatus,
          startedAt: s.startedAt.toISOString(),
          nextDueDate: s.nextDueDate?.toISOString() ?? null,
        })),
      },
      transactions: transactions.map((t) => ({
        id: t.id,
        amount: Number(t.amount),
        description: t.description,
        date: t.date.toISOString(),
        type: t.type,
        action: t.investmentAction,
        quantity: t.investmentQty == null ? null : Number(t.investmentQty),
        price: t.investmentPrice == null ? null : Number(t.investmentPrice),
        account: t.account,
        accountId: t.accountId,
        cardId: t.cardId,
        user: t.user,
      })),
      reminders: reminders.map((r) => ({
        id: r.id,
        kind: r.kind,
        dueDate: r.dueDate.toISOString(),
        amount: r.amount == null ? null : Number(r.amount),
        status: r.status,
      })),
    });
  } catch (e) {
    return err(e);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireWorkspace("investments", "write");
    const session = await auth();
    const { id } = await context.params;
    const inv = await prisma.investment.findUnique({ where: { id } });
    if (!inv || inv.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!canModifyRecord(session, inv)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = await request.json();
    const parsed = investmentUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const data = parsed.data;

    // Day-window lock — anchored on the RECORD's `createdAt`, not the
    // investment's `startedAt`. For insurance policies in particular,
    // `startedAt` is the policy's real-life effective date (which can be
    // months or years in the past); the lock is meant to prevent
    // back-dated tampering of transactional entries, not stop a user
    // from correcting a typo in a policy they just added today.
    // Insurance policies are long-lived metadata and skip the lock entirely.
    if (inv.kind !== "INSURANCE") {
      const lock = await checkDayWindowEditAllowed({
        date: inv.createdAt,
        workspaceId: inv.workspaceId,
        role: ctx.role,
        force: body?.force === true,
        entityName: "investment",
      });
      if (!lock.ok) {
        return NextResponse.json(
          { error: lock.message, canForce: lock.canForce },
          { status: lock.status },
        );
      }
    }

    // When `splits` is supplied, the caller is editing the full holding —
    // wipe the existing BUY transactions and recreate from the new splits.
    // SELL/other-action txns are preserved so a holding's history isn't
    // erased by a metadata edit. Validate ownership of every funding
    // source up-front so we don't half-apply.
    const cardIdToAccountId = new Map<string, string | null>();
    if (data.splits && data.splits.length > 0) {
      const accountIds = [...new Set(data.splits.map((s) => s.accountId).filter(Boolean) as string[])];
      const cardIds = [...new Set(data.splits.map((s) => s.cardId).filter(Boolean) as string[])];
      const [accs, cards] = await Promise.all([
        accountIds.length
          ? prisma.account.findMany({ where: { id: { in: accountIds } } })
          : Promise.resolve([]),
        cardIds.length
          ? prisma.card.findMany({ where: { id: { in: cardIds } } })
          : Promise.resolve([]),
      ]);
      if (accs.length !== accountIds.length || cards.length !== cardIds.length) {
        return NextResponse.json({ error: "Payment source not found" }, { status: 404 });
      }
      for (const a of accs) {
        if (a.workspaceId !== ctx.workspaceId || !canAccessRecord(session, a)) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
      }
      for (const c of cards) {
        if (c.workspaceId !== ctx.workspaceId || !canAccessRecord(session, c)) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        cardIdToAccountId.set(c.id, c.accountId);
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      // When splits are provided, replace all BUY transactions atomically.
      // SELL/other-action txns are preserved so a holding's history isn't
      // erased by a metadata edit. Investment.amount and quantity are then
      // recomputed as `sumBuys − sumSells` to keep the running totals
      // honest in the (rare) case that an edited holding already has SELL
      // history. Limitation: BUYs added later via /api/transactions (e.g.
      // a gold top-up) are also deleted by this replacement — gold-create
      // is the only flow that opens this PATCH path, so it's acceptable.
      let derivedAmount: number | undefined;
      let derivedQuantity: number | undefined;
      if (data.splits && data.splits.length > 0) {
        const sellsAgg = await tx.transaction.aggregate({
          where: {
            investmentId: id,
            investmentAction: InvestmentAction.SELL,
          },
          _sum: { amount: true, investmentQty: true },
        });
        await tx.transaction.deleteMany({
          where: { investmentId: id, investmentAction: InvestmentAction.BUY },
        });
        const startedAt = data.startedAt ? new Date(data.startedAt) : inv.startedAt;
        const description = `${inv.kind} · ${data.name ?? inv.name}`;
        await tx.transaction.createMany({
          data: data.splits.map((s, i) => {
            const cardCompanionAccount = s.cardId
              ? (cardIdToAccountId.get(s.cardId) ?? null)
              : null;
            return {
              workspaceId: ctx.workspaceId,
              type: TransactionType.INVESTMENT,
              amount: s.amount,
              description:
                data.splits!.length > 1
                  ? `${description} (${i + 1}/${data.splits!.length})`
                  : description,
              date: startedAt,
              accountId: s.accountId ?? cardCompanionAccount,
              cardId: s.cardId ?? null,
              investmentId: id,
              investmentAction: InvestmentAction.BUY,
              goldForm:
                inv.kind === "GOLD" && data.goldForm ? data.goldForm : null,
              userId: ctx.userId,
              createdByUserId: ctx.userId,
            };
          }),
        });
        const buySum = data.splits.reduce((a, s) => a + s.amount, 0);
        const sellAmt = Number(sellsAgg._sum.amount ?? 0);
        const sellQty = Number(sellsAgg._sum.investmentQty ?? 0);
        derivedAmount = Math.max(0, buySum - sellAmt);
        const incomingQty = data.quantity ?? Number(inv.quantity ?? 0);
        derivedQuantity = Math.max(0, incomingQty - sellQty);
      }

      return tx.investment.update({
        where: { id },
        data: {
          name: data.name ?? inv.name,
          institution: data.institution ?? inv.institution,
          amount: derivedAmount ?? data.amount ?? inv.amount,
          currentValue: data.currentValue ?? inv.currentValue,
          interestRate: data.interestRate ?? inv.interestRate,
          startedAt: data.startedAt ? new Date(data.startedAt) : inv.startedAt,
          maturityAt: data.maturityAt ? new Date(data.maturityAt) : inv.maturityAt,
          notes: data.notes ?? inv.notes,
          active: data.active ?? inv.active,
          symbol: data.symbol ?? inv.symbol,
          quantity: derivedQuantity ?? data.quantity ?? inv.quantity,
          purchasePrice: data.purchasePrice ?? inv.purchasePrice,
          purchaseExchangeRate:
            data.purchaseExchangeRate ?? inv.purchaseExchangeRate,
          dividends: data.dividends ?? inv.dividends,
          exchange: data.exchange ?? inv.exchange,
          currency: data.currency ?? inv.currency,
          policyNumber: data.policyNumber ?? inv.policyNumber,
          policyType: data.policyType ?? inv.policyType,
          premiumAmount: data.premiumAmount ?? inv.premiumAmount,
          premiumFrequency: data.premiumFrequency ?? inv.premiumFrequency,
          sumAssured: data.sumAssured ?? inv.sumAssured,
          nextDueDate: data.nextDueDate ? new Date(data.nextDueDate) : inv.nextDueDate,
          nominee: data.nominee ?? inv.nominee,
          // Phase 2 — vehicle link for VEHICLE policies.
          vehicleId: data.vehicleId ?? inv.vehicleId,
          // Phase 3 — life-insurance corporate fields.
          policyTermYears: data.policyTermYears ?? inv.policyTermYears,
          premiumPayingTermYears:
            data.premiumPayingTermYears ?? inv.premiumPayingTermYears,
          maturityValue: data.maturityValue ?? inv.maturityValue,
          bonusAccrued: data.bonusAccrued ?? inv.bonusAccrued,
          bonusLastRevisedAt: data.bonusLastRevisedAt
            ? new Date(data.bonusLastRevisedAt)
            : inv.bonusLastRevisedAt,
          ridersJson:
            data.ridersJson !== undefined
              ? ((data.ridersJson as Prisma.InputJsonValue | null) ??
                Prisma.JsonNull)
              : (inv.ridersJson ?? Prisma.JsonNull),
          metadata:
            data.metadata !== undefined
              ? (data.metadata as Prisma.InputJsonValue | null) ?? Prisma.JsonNull
              : (inv.metadata ?? Prisma.JsonNull),
        },
      });
    });

    // Top up INSURANCE premium reminders after the edit. If the user
    // extended maturity or set a longer policy term, the schedule
    // should grow to match — without this, a 36-month policy edited
    // from a 12-month seed would still show only 12 reminders.
    if (updated.kind === "INSURANCE" && updated.premiumFrequency && updated.nextDueDate) {
      const expected = policyReminderCount({
        frequency: updated.premiumFrequency as PremiumFrequency,
        firstDueDate: updated.nextDueDate,
        premiumPayingTermYears: updated.premiumPayingTermYears,
        policyTermYears: updated.policyTermYears,
        maturityAt: updated.maturityAt,
      });
      const existing = await prisma.investmentReminder.findMany({
        where: { investmentId: id, kind: ReminderKind.INSURANCE_PREMIUM },
        select: { dueDate: true },
      });
      if (existing.length < expected) {
        const dates = computeReminderSchedule({
          firstDueDate: updated.nextDueDate,
          frequency: updated.premiumFrequency as PremiumFrequency,
          count: expected,
        });
        const have = new Set(
          existing.map((r) => r.dueDate.toISOString().slice(0, 10)),
        );
        const missing = dates.filter(
          (d) => !have.has(d.toISOString().slice(0, 10)),
        );
        if (missing.length > 0) {
          await prisma.investmentReminder.createMany({
            data: missing.map((d) => ({
              workspaceId: updated.workspaceId,
              investmentId: id,
              kind: ReminderKind.INSURANCE_PREMIUM,
              dueDate: d,
              amount: updated.premiumAmount ?? null,
              status: ReminderStatus.UPCOMING,
            })),
          });
        }
      }
    }

    return NextResponse.json({ id: updated.id });
  } catch (e) {
    return err(e);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireWorkspace("investments", "write");
    const session = await auth();
    const { id } = await context.params;
    const inv = await prisma.investment.findUnique({ where: { id } });
    if (!inv || inv.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!canModifyRecord(session, inv)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    // Day-window lock for delete (matches PATCH). Anchored on
    // `createdAt`, and skipped entirely for INSURANCE policies (see PATCH
    // comment above). DELETE has no body, so the force-override is
    // passed via `?force=1` query string.
    if (inv.kind !== "INSURANCE") {
      const force =
        new URL(request.url).searchParams.get("force") === "1";
      const lock = await checkDayWindowEditAllowed({
        date: inv.createdAt,
        workspaceId: inv.workspaceId,
        role: ctx.role,
        force,
        entityName: "investment",
      });
      if (!lock.ok) {
        return NextResponse.json(
          { error: lock.message, canForce: lock.canForce },
          { status: lock.status },
        );
      }
    }
    // Chain-integrity guard for insurance policies: if this policy is
    // the predecessor of a renewal chain (someone renewed it into a new
    // row), refuse delete. The FK is SET NULL so the successor would
    // survive — but losing the predecessor breaks the audit trail of
    // "this policy used to be X". User must delete the successor first
    // or archive instead.
    const successor = await prisma.investment.findFirst({
      where: { renewedFromInvestmentId: id },
      select: { id: true, name: true },
    });
    if (successor) {
      return NextResponse.json(
        {
          error: `This policy was renewed into "${successor.name}". Delete the renewed policy first, or archive this one instead.`,
        },
        { status: 409 },
      );
    }
    // Cascade-delete linked transactions first so the holding can be
    // removed cleanly. The Transaction.investmentId FK is `onDelete:
    // SetNull` (set in schema) which would orphan the rows otherwise —
    // we want them gone with the holding since that's what the user just
    // confirmed. InvestmentReminder + InsuredMember + InsuranceClaim
    // cascade automatically via their FKs.
    // Wrapped in a $transaction so a failure mid-delete rolls back.
    await prisma.$transaction(async (tx) => {
      await tx.transaction.deleteMany({ where: { investmentId: id } });
      await tx.investment.delete({ where: { id } });
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}
