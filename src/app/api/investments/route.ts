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
          startedAt: new Date(data.startedAt),
          maturityAt: data.maturityAt ? new Date(data.maturityAt) : null,
          notes: data.notes,
          symbol: data.symbol,
          quantity: data.quantity ?? null,
          purchasePrice: data.purchasePrice ?? null,
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
        },
      });

      // Post initial BUY transaction unless it's an already-existing holding.
      if (!data.isExisting && data.accountId) {
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
