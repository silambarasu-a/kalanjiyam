import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { canAccessRecord, visibilityFilter } from "@/lib/permissions";
import { loanCreateSchema } from "@/lib/validators-domain";
import {
  LoanKind,
  LoanSource,
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
          outstanding: data.outstanding ?? data.principal,
          interestRate: data.interestRate ?? null,
          gstOnInterest: data.gstOnInterest ?? null,
          emiAmount: data.emiAmount ?? null,
          tenure: data.tenure ?? null,
          frequency: data.frequency ?? "MONTHLY",
          charges: data.charges ?? null,
          accountId: data.accountId ?? null,
          cardId: data.cardId ?? null,
          isExisting: data.isExisting ?? false,
          startedAt: new Date(data.startedAt),
          maturityAt: data.maturityAt ? new Date(data.maturityAt) : null,
          nextDueDate: data.nextDueDate ? new Date(data.nextDueDate) : null,
          notes: data.notes,
        },
      });

      // BANK disbursement — if a payout account is linked and loan isn't flagged
      // as existing, money arrives into that account as INCOME kind=LOAN_PAYMENT.
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
