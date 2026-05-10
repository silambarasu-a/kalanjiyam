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
  Prisma,
} from "@/generated/prisma/client";

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
    const inv = await prisma.investment.findUnique({ where: { id } });
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
        take: 24,
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

    // Day-window lock — same rule the rest of the app uses for editing
    // older records. The investment's `startedAt` is the anchor: after the
    // workspace's edit window passes, only OWNER/ADMIN can edit (with a
    // `force: true` flag). Members get a 423 with the standard message.
    {
      const lock = await checkDayWindowEditAllowed({
        date: inv.startedAt,
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
          premiumAmount: data.premiumAmount ?? inv.premiumAmount,
          nextDueDate: data.nextDueDate ? new Date(data.nextDueDate) : inv.nextDueDate,
          nominee: data.nominee ?? inv.nominee,
          metadata:
            data.metadata !== undefined
              ? (data.metadata as Prisma.InputJsonValue | null) ?? Prisma.JsonNull
              : (inv.metadata ?? Prisma.JsonNull),
        },
      });
    });
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
    // Day-window lock for delete (matches PATCH). DELETE has no body,
    // so the force-override is passed via `?force=1` query string.
    {
      const force =
        new URL(request.url).searchParams.get("force") === "1";
      const lock = await checkDayWindowEditAllowed({
        date: inv.startedAt,
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
    // Cascade-delete linked transactions first so the holding can be
    // removed cleanly. The Transaction.investmentId FK is `onDelete:
    // SetNull` (set in schema) which would orphan the rows otherwise —
    // we want them gone with the holding since that's what the user just
    // confirmed. InvestmentReminder cascades automatically via its FK.
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
