import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { canAccessRecord, visibilityFilter } from "@/lib/permissions";
import { loanCreateSchema } from "@/lib/validators-domain";
import { calculateEMI, countPaidEmis, monthsPerCycle, advanceByCycle } from "@/lib/loan-math";
import {
  LoanKind,
  LoanSource,
  LoanFrequency,
  TransactionType,
  TransactionKind,
} from "@/generated/prisma/client";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[loans]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

function featureForSource(source: "BANK" | "HAND_FORMAL" | "CARD_EMI") {
  return source === "BANK" ? "bank_loans" : source === "CARD_EMI" ? "card_emi" : "hand_loans";
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const source = url.searchParams.get("source") as LoanSource | null;
    const feature = source ? featureForSource(source) : "bank_loans";
    const ctx = await requireWorkspace(feature, "read");
    const session = await auth();

    const loans = await prisma.loan.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        ...(source ? { source } : {}),
        ...visibilityFilter(session, ctx.ownOnly),
      },
      orderBy: [{ active: "desc" }, { startedAt: "desc" }],
      include: {
        ownerUser: { select: { id: true, name: true } },
        account: { select: { id: true, name: true } },
        card: { select: { id: true, name: true } },
        goldItems: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            name: true,
            quantity: true,
            weightGrams: true,
            purity: true,
            notes: true,
          },
        },
      },
    });
    return NextResponse.json({
      loans: loans.map((l) => ({
        id: l.id,
        kind: l.kind,
        source: l.source,
        lender: l.lender,
        borrower: l.borrower,
        principal: Number(l.principal),
        outstanding: Number(l.outstanding),
        interestRate: l.interestRate == null ? null : Number(l.interestRate),
        gstOnInterest: l.gstOnInterest == null ? null : Number(l.gstOnInterest),
        emiAmount: l.emiAmount == null ? null : Number(l.emiAmount),
        tenure: l.tenure,
        frequency: l.frequency,
        charges: l.charges == null ? null : Number(l.charges),
        chargeBreakdown: l.chargeBreakdown ?? null,
        account: l.account,
        card: l.card,
        isExisting: l.isExisting,
        startedAt: l.startedAt.toISOString(),
        maturityAt: l.maturityAt?.toISOString() ?? null,
        nextDueDate: l.nextDueDate?.toISOString() ?? null,
        foreclosedAt: l.foreclosedAt?.toISOString() ?? null,
        notes: l.notes,
        active: l.active,
        ownerUser: l.ownerUser,
        goldItems: l.goldItems.map((g) => ({
          id: g.id,
          name: g.name,
          quantity: g.quantity,
          weightGrams: Number(g.weightGrams),
          purity: g.purity,
          notes: g.notes,
        })),
      })),
    });
  } catch (e) {
    return err(e);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = loanCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const feature = featureForSource(parsed.data.source);
    const ctx = await requireWorkspace(feature, "write");
    const session = await auth();
    const data = parsed.data;

    if (data.cardId) {
      const card = await prisma.card.findUnique({ where: { id: data.cardId } });
      if (!card || card.workspaceId !== ctx.workspaceId) {
        return NextResponse.json({ error: "Card not found" }, { status: 404 });
      }
      if (!canAccessRecord(session, card)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }
    if (data.accountId) {
      const account = await prisma.account.findUnique({ where: { id: data.accountId } });
      if (!account || account.workspaceId !== ctx.workspaceId) {
        return NextResponse.json({ error: "Account not found" }, { status: 404 });
      }
      if (!canAccessRecord(session, account)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    // tenure is the number of payment cycles (months for MONTHLY,
    // quarters for QUARTERLY, etc.). Convert to total months for the
    // maturity date math.
    const frequency = data.frequency ?? "MONTHLY";
    const tenureCycles = data.tenure ?? null;
    const totalMonths =
      tenureCycles != null ? tenureCycles * monthsPerCycle(frequency) : null;

    // Server-side fallback: if the client didn't send an explicit emiAmount
    // but we have principal + rate + tenure, compute the standard
    // reducing-balance EMI so every loan has a numeric EMI on file.
    const computedEmi =
      data.emiAmount ??
      (data.interestRate != null && tenureCycles
        ? calculateEMI(data.principal, data.interestRate, tenureCycles, frequency) || null
        : null);

    // Maturity falls out of startedAt + total months when the client
    // hasn't overridden it.
    const computedMaturity =
      data.maturityAt
        ? new Date(data.maturityAt)
        : totalMonths
          ? (() => {
              const m = new Date(data.startedAt);
              m.setMonth(m.getMonth() + totalMonths);
              return m;
            })()
          : null;

    // First due date: startedAt + 1 cycle, advanced past any already-paid
    // cycles for `isExisting` loans.
    const computedNextDueDate =
      data.nextDueDate
        ? new Date(data.nextDueDate)
        : computedEmi && tenureCycles
          ? (() => {
              const start = new Date(data.startedAt);
              let advance = 1;
              if (
                data.isExisting &&
                data.interestRate != null &&
                data.outstanding != null &&
                data.outstanding < data.principal
              ) {
                const paid = countPaidEmis(
                  data.principal,
                  data.interestRate,
                  computedEmi,
                  tenureCycles,
                  frequency,
                  data.outstanding
                );
                advance = paid + 1;
              }
              return advanceByCycle(start, frequency, advance);
            })()
          : null;

    // If the client supplied a per-line breakdown, sum it; otherwise fall
    // back to the explicit `charges` total. This is the amount that banks
    // deduct upfront — processing fee, GST, stamp duty, insurance, etc.
    const breakdown = data.chargeBreakdown ?? [];
    const chargesTotal = breakdown.length
      ? Math.round(breakdown.reduce((s, c) => s + (c.amount || 0), 0) * 100) / 100
      : data.charges ?? 0;

    // Gold items are only meaningful for GOLD-kind loans; ignore on other
    // kinds even if the client mistakenly sent them.
    const goldItems =
      data.kind === "GOLD" && data.goldItems?.length ? data.goldItems : [];

    // An existing loan entered with zero outstanding is already paid off —
    // mirror the pay handler's auto-close so it doesn't show up under active.
    const initialOutstanding = data.outstanding ?? data.principal;
    const isAlreadyPaid = initialOutstanding <= 0;

    const result = await prisma.$transaction(async (tx) => {
      const loan = await tx.loan.create({
        data: {
          workspaceId: ctx.workspaceId,
          ownerUserId: ctx.userId,
          kind: data.kind as LoanKind,
          source: data.source as LoanSource,
          lender: data.lender,
          borrower: data.borrower,
          principal: data.principal,
          outstanding: initialOutstanding,
          interestRate: data.interestRate ?? null,
          gstOnInterest: data.gstOnInterest ?? null,
          emiAmount: computedEmi,
          tenure: data.tenure ?? null,
          frequency: frequency as LoanFrequency,
          charges: chargesTotal > 0 ? chargesTotal : null,
          chargeBreakdown: breakdown.length ? breakdown : undefined,
          accountId: data.accountId ?? null,
          cardId: data.cardId ?? null,
          isExisting: data.isExisting ?? false,
          startedAt: new Date(data.startedAt),
          maturityAt: computedMaturity,
          nextDueDate: isAlreadyPaid ? null : computedNextDueDate,
          active: !isAlreadyPaid,
          foreclosedAt: isAlreadyPaid ? new Date() : null,
          notes: data.notes,
          goldItems: goldItems.length
            ? {
                create: goldItems.map((g) => ({
                  name: g.name,
                  quantity: g.quantity ?? 1,
                  weightGrams: g.weightGrams,
                  purity: g.purity ?? null,
                  notes: g.notes ?? null,
                })),
              }
            : undefined,
        },
      });

      // BANK disbursement — full principal is credited to the account as
      // INCOME, then upfront charges (processing fee, stamp duty, GST,
      // insurance, etc.) post as a separate EXPENSE. Net account change is
      // (principal − charges), matching how banks show it on the passbook
      // and keeping fees discoverable as real expenses in reports.
      if (!data.isExisting && data.source === "BANK" && data.accountId) {
        await tx.transaction.create({
          data: {
            workspaceId: ctx.workspaceId,
            type: TransactionType.INCOME,
            kind: TransactionKind.LOAN_PAYMENT,
            amount: data.principal,
            description: `Loan disbursement · ${data.lender}`,
            date: new Date(data.startedAt),
            accountId: data.accountId,
            loanId: loan.id,
            userId: ctx.userId,
            createdByUserId: ctx.userId,
          },
        });

        if (chargesTotal > 0) {
          const chargeLabel =
            breakdown.length > 0
              ? breakdown.map((c) => c.label).join(", ")
              : "Processing & other charges";
          await tx.transaction.create({
            data: {
              workspaceId: ctx.workspaceId,
              type: TransactionType.EXPENSE,
              kind: TransactionKind.OTHER_EXPENSE,
              amount: chargesTotal,
              description: `Loan charges · ${data.lender} · ${chargeLabel}`,
              date: new Date(data.startedAt),
              accountId: data.accountId,
              loanId: loan.id,
              userId: ctx.userId,
              createdByUserId: ctx.userId,
            },
          });
        }
      }

      // CARD_EMI — the underlying purchase is already an expense on the card
      // elsewhere. The Loan reduces the card's available limit via its
      // outstanding principal (see /api/cards available-limit math). No extra
      // transaction at creation.
      return loan;
    });

    return NextResponse.json({ id: result.id });
  } catch (e) {
    return err(e);
  }
}
