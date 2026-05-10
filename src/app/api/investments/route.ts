import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { canAccessRecord, visibilityFilter } from "@/lib/permissions";
import { investmentCreateSchema } from "@/lib/validators-domain";
import { computeReminderSchedule } from "@/lib/reminder-schedule";
import {
  InvestmentKind,
  InsurancePolicyType,
  PremiumFrequency,
  TransactionType,
  InvestmentAction,
  ReminderKind,
  ReminderStatus,
  Prisma,
} from "@/generated/prisma/client";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[investments]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const ctx = await requireWorkspace("investments", "read");
    const session = await auth();
    const url = new URL(request.url);
    const kind = url.searchParams.get("kind") as InvestmentKind | null;
    const investments = await prisma.investment.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        ...(kind ? { kind } : {}),
        ...visibilityFilter(session, ctx.ownOnly),
      },
      orderBy: [{ active: "desc" }, { startedAt: "desc" }],
      include: { ownerUser: { select: { id: true, name: true } } },
    });
    return NextResponse.json({
      investments: investments.map((i) => ({
        id: i.id,
        kind: i.kind,
        name: i.name,
        institution: i.institution,
        amount: Number(i.amount),
        currentValue: i.currentValue == null ? null : Number(i.currentValue),
        interestRate: i.interestRate == null ? null : Number(i.interestRate),
        startedAt: i.startedAt.toISOString(),
        maturityAt: i.maturityAt?.toISOString() ?? null,
        active: i.active,
        notes: i.notes,
        symbol: i.symbol,
        quantity: i.quantity == null ? null : Number(i.quantity),
        purchasePrice: i.purchasePrice == null ? null : Number(i.purchasePrice),
        purchaseExchangeRate:
          i.purchaseExchangeRate == null ? null : Number(i.purchaseExchangeRate),
        dividends: i.dividends == null ? null : Number(i.dividends),
        exchange: i.exchange,
        currency: i.currency,
        policyNumber: i.policyNumber,
        policyType: i.policyType,
        premiumAmount: i.premiumAmount == null ? null : Number(i.premiumAmount),
        premiumFrequency: i.premiumFrequency,
        sumAssured: i.sumAssured == null ? null : Number(i.sumAssured),
        nextDueDate: i.nextDueDate?.toISOString() ?? null,
        nominee: i.nominee,
        metadata: i.metadata ?? null,
        lockedUntil: i.lockedUntil?.toISOString() ?? null,
        ownerUser: i.ownerUser,
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
    const parsed = investmentCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const data = parsed.data;

    if (data.accountId) {
      const account = await prisma.account.findUnique({ where: { id: data.accountId } });
      if (!account || account.workspaceId !== ctx.workspaceId) {
        return NextResponse.json({ error: "Account not found" }, { status: 404 });
      }
      if (!canAccessRecord(session, account)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    // Validate every funding source referenced by splits belongs to this
    // workspace and the caller can spend from it. Done up-front so we don't
    // partially create the holding before failing. The cardId→accountId
    // map is captured here so the $transaction below can route card spends
    // through the card's companion account (kind=CARD), the same way
    // /api/transactions does — without that, the card's outstanding never
    // moves and `availableLimit` stays stale.
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

    // Default lock-until based on kind unless the caller supplied one.
    // FD/RD lock to maturityAt; SIP defaults to a 3y ELSS-style window;
    // INSURANCE locks to startedAt+5y only when policyType = ULIP.
    const startedAtDate = new Date(data.startedAt);
    const addYears = (d: Date, n: number) => {
      const c = new Date(d);
      c.setFullYear(c.getFullYear() + n);
      return c;
    };
    let lockedUntil: Date | null = data.lockedUntil
      ? new Date(data.lockedUntil)
      : null;
    if (lockedUntil == null) {
      if ((data.kind === "FD" || data.kind === "RD") && data.maturityAt) {
        lockedUntil = new Date(data.maturityAt);
      } else if (data.kind === "SIP") {
        lockedUntil = addYears(startedAtDate, 3);
      } else if (data.kind === "INSURANCE" && data.policyType === "ULIP") {
        lockedUntil = addYears(startedAtDate, 5);
      }
    }

    const investment = await prisma.$transaction(async (tx) => {
      const inv = await tx.investment.create({
        data: {
          workspaceId: ctx.workspaceId,
          ownerUserId: ctx.userId,
          kind: data.kind as InvestmentKind,
          name: data.name,
          institution: data.institution,
          amount: data.amount,
          currentValue: data.currentValue ?? null,
          interestRate: data.interestRate ?? null,
          startedAt: startedAtDate,
          maturityAt: data.maturityAt ? new Date(data.maturityAt) : null,
          notes: data.notes,
          symbol: data.symbol,
          quantity: data.quantity ?? null,
          purchasePrice: data.purchasePrice ?? null,
          purchaseExchangeRate: data.purchaseExchangeRate ?? null,
          dividends: data.dividends ?? null,
          exchange: data.exchange,
          currency: data.currency ?? "INR",
          policyNumber: data.policyNumber,
          policyType: data.policyType as InsurancePolicyType | undefined,
          premiumAmount: data.premiumAmount ?? null,
          premiumFrequency: data.premiumFrequency as PremiumFrequency | undefined,
          sumAssured: data.sumAssured ?? null,
          nextDueDate: data.nextDueDate ? new Date(data.nextDueDate) : null,
          nominee: data.nominee,
          metadata: (data.metadata as Prisma.InputJsonValue) ?? undefined,
          lockedUntil,
        },
      });

      // Post initial BUY transaction(s) unless it's an already-existing
      // holding. `splits` wins over `accountId`: one BUY per split, each
      // pointing at its own account or card. The Investment row holds the
      // canonical qty/price; per-split txns leave those null since
      // pro-rating is rarely meaningful for split-tender purchases.
      if (!data.isExisting) {
        if (data.splits && data.splits.length > 0) {
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
                    ? `${data.kind} · ${data.name} (${i + 1}/${data.splits!.length})`
                    : `${data.kind} · ${data.name}`,
                date: new Date(data.startedAt),
                accountId: s.accountId ?? cardCompanionAccount,
                cardId: s.cardId ?? null,
                investmentId: inv.id,
                investmentAction: InvestmentAction.BUY,
                userId: ctx.userId,
                createdByUserId: ctx.userId,
              };
            }),
          });
        } else if (data.accountId) {
          await tx.transaction.create({
            data: {
              workspaceId: ctx.workspaceId,
              type: TransactionType.INVESTMENT,
              amount: data.amount,
              description: `${data.kind} · ${data.name}`,
              date: new Date(data.startedAt),
              accountId: data.accountId,
              investmentId: inv.id,
              investmentAction: InvestmentAction.BUY,
              investmentQty: data.quantity ?? null,
              investmentPrice: data.purchasePrice ?? null,
              userId: ctx.userId,
              createdByUserId: ctx.userId,
            },
          });
        }
      }

      // Generate upcoming reminders for SIP + INSURANCE + FD maturity.
      if (data.kind === "SIP" && data.premiumFrequency && data.nextDueDate) {
        const dates = computeReminderSchedule({
          firstDueDate: new Date(data.nextDueDate),
          frequency: data.premiumFrequency as PremiumFrequency,
          count: 12,
        });
        await tx.investmentReminder.createMany({
          data: dates.map((d) => ({
            workspaceId: ctx.workspaceId,
            investmentId: inv.id,
            kind: ReminderKind.SIP_BUY,
            dueDate: d,
            amount: data.premiumAmount ?? data.amount,
            status: ReminderStatus.UPCOMING,
          })),
        });
      }
      if (data.kind === "INSURANCE" && data.premiumFrequency && data.nextDueDate) {
        const dates = computeReminderSchedule({
          firstDueDate: new Date(data.nextDueDate),
          frequency: data.premiumFrequency as PremiumFrequency,
          count: 12,
        });
        await tx.investmentReminder.createMany({
          data: dates.map((d) => ({
            workspaceId: ctx.workspaceId,
            investmentId: inv.id,
            kind: ReminderKind.INSURANCE_PREMIUM,
            dueDate: d,
            amount: data.premiumAmount ?? null,
            status: ReminderStatus.UPCOMING,
          })),
        });
      }
      if (data.kind === "FD" && data.maturityAt) {
        await tx.investmentReminder.create({
          data: {
            workspaceId: ctx.workspaceId,
            investmentId: inv.id,
            kind: ReminderKind.FD_INTEREST,
            dueDate: new Date(data.maturityAt),
            amount: null,
            status: ReminderStatus.UPCOMING,
          },
        });
      }

      return inv;
    });

    return NextResponse.json({ id: investment.id });
  } catch (e) {
    return err(e);
  }
}
