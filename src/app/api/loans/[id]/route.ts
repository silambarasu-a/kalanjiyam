import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { canAccessRecord, canModifyRecord } from "@/lib/permissions";
import { loanUpdateSchema } from "@/lib/validators-domain";
import {
  Prisma,
  TransactionType,
  TransactionKind,
} from "@/generated/prisma/client";
import {
  advanceByCycle,
  calculateEMI,
  countPaidEmis,
  monthsPerCycle,
  type LoanFrequency,
} from "@/lib/loan-math";
import { nextStatementDueDate } from "@/lib/statement-period";
import { archiveAttachmentsForOwner } from "@/lib/attachment-archive";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

function featureForSource(source: string) {
  return source === "BANK" ? "bank_loans" : source === "CARD_EMI" ? "card_emi" : "hand_loans";
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const loan = await prisma.loan.findUnique({
      where: { id },
      include: {
        account: { select: { id: true, name: true } },
        card: { select: { id: true, name: true } },
        lenderContact: { select: { id: true, name: true } },
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
    if (!loan) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const ctx = await requireWorkspace(featureForSource(loan.source), "read");
    const session = await auth();
    if (loan.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!canAccessRecord(session, loan)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const payments = await prisma.transaction.findMany({
      where: { loanId: id },
      orderBy: { date: "desc" },
      take: 50,
    });
    return NextResponse.json({
      loan: {
        id: loan.id,
        kind: loan.kind,
        source: loan.source,
        lender: loan.lenderContact?.name ?? loan.lender,
        lenderContact: loan.lenderContact,
        borrower: loan.borrower,
        principal: Number(loan.principal),
        outstanding: Number(loan.outstanding),
        interestRate: loan.interestRate == null ? null : Number(loan.interestRate),
        gstOnInterest: loan.gstOnInterest == null ? null : Number(loan.gstOnInterest),
        emiAmount: loan.emiAmount == null ? null : Number(loan.emiAmount),
        tenure: loan.tenure,
        frequency: loan.frequency,
        charges: loan.charges == null ? null : Number(loan.charges),
        chargeBreakdown: loan.chargeBreakdown ?? null,
        isExisting: loan.isExisting,
        account: loan.account,
        card: loan.card,
        loanAccountNumber: loan.loanAccountNumber,
        loanStatementDate: loan.loanStatementDate,
        loanGracePeriod: loan.loanGracePeriod,
        startedAt: loan.startedAt.toISOString(),
        maturityAt: loan.maturityAt?.toISOString() ?? null,
        nextDueDate: loan.nextDueDate?.toISOString() ?? null,
        foreclosedAt: loan.foreclosedAt?.toISOString() ?? null,
        notes: loan.notes,
        active: loan.active,
        goldItems: loan.goldItems.map((g) => ({
          id: g.id,
          name: g.name,
          quantity: g.quantity,
          weightGrams: Number(g.weightGrams),
          purity: g.purity,
          notes: g.notes,
        })),
      },
      payments: payments.map((p) => ({
        id: p.id,
        amount: Number(p.amount),
        date: p.date.toISOString(),
        description: p.description,
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
    const { id } = await context.params;
    const loan = await prisma.loan.findUnique({ where: { id } });
    if (!loan) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const ctx = await requireWorkspace(featureForSource(loan.source), "write");
    const session = await auth();
    if (loan.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!canModifyRecord(session, loan)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = await request.json();
    const parsed = loanUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const data = parsed.data;

    // Closed loans are immutable. The closing EMI itself can still be
    // adjusted (or reversed) inside its 3-day grace window via the
    // transaction PATCH/DELETE — re-opening the loan that way is the
    // supported path back to editing the loan record.
    // OWNER/ADMIN can override with `force: true` to correct historical
    // mistakes (e.g. wrong principal entered before the loan was closed).
    if (!loan.active) {
      const force = body?.force === true;
      const isAdmin =
        ctx.role === "OWNER" ||
        ctx.role === "ADMIN" ||
        ctx.role === "SUPER_ADMIN";
      if (!force || !isAdmin) {
        return NextResponse.json(
          {
            error: isAdmin
              ? "This loan is closed. Re-submit with force=true to override."
              : "This loan is closed and locked. Ask an Owner or Admin to override.",
            canForce: isAdmin,
          },
          { status: 423 },
        );
      }
    }

    // Source change is unsupported — different feature/UI per source. The
    // form locks this, so a mismatch is a programmer error, not a user one.
    if (data.source && data.source !== loan.source) {
      return NextResponse.json(
        { error: "Cannot change loan source" },
        { status: 400 }
      );
    }
    // CARD_EMI is always isExisting=true — the underlying purchase already
    // posted as a card expense, so toggling makes no sense for that source.
    // For BANK and HAND* loans we let it flip and reconcile the auto
    // transactions further down.
    const newIsExisting =
      data.isExisting !== undefined ? data.isExisting : loan.isExisting;
    if (newIsExisting !== loan.isExisting && loan.source === "CARD_EMI") {
      return NextResponse.json(
        { error: "Cannot change existing-loan flag for card EMI loans" },
        { status: 400 }
      );
    }

    // Workspace-scope check the new account/card if either was changed.
    // For the CREDIT_CARD_LOAN kind we also need the linked card account's
    // statementDate / gracePeriod to recompute the next due date below.
    let cardStatement: { statementDate: number | null; gracePeriod: number | null } | null = null;
    const effectiveCardId =
      data.cardId !== undefined ? data.cardId : loan.cardId;
    const effectiveKind = data.kind ?? loan.kind;
    if (data.cardId && data.cardId !== loan.cardId) {
      const card = await prisma.card.findUnique({
        where: { id: data.cardId },
        include: {
          account: { select: { statementDate: true, gracePeriod: true } },
        },
      });
      if (!card || card.workspaceId !== ctx.workspaceId) {
        return NextResponse.json({ error: "Card not found" }, { status: 404 });
      }
      if (!canAccessRecord(session, card)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      cardStatement = card.account
        ? { statementDate: card.account.statementDate, gracePeriod: card.account.gracePeriod }
        : null;
    } else if (effectiveKind === "CREDIT_CARD_LOAN" && effectiveCardId) {
      const card = await prisma.card.findUnique({
        where: { id: effectiveCardId },
        include: {
          account: { select: { statementDate: true, gracePeriod: true } },
        },
      });
      cardStatement = card?.account
        ? { statementDate: card.account.statementDate, gracePeriod: card.account.gracePeriod }
        : null;
    }
    if (data.accountId && data.accountId !== loan.accountId) {
      const account = await prisma.account.findUnique({
        where: { id: data.accountId },
      });
      if (!account || account.workspaceId !== ctx.workspaceId) {
        return NextResponse.json({ error: "Account not found" }, { status: 404 });
      }
      if (!canAccessRecord(session, account)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    // lenderContactId is only meaningful for HAND_FORMAL — reject the
    // field outright on other sources so a stray client (or future bug)
    // can't attach a contact to a bank loan.
    if (data.lenderContactId !== undefined && loan.source !== "HAND_FORMAL") {
      return NextResponse.json(
        { error: "Lender contact only applies to hand loans" },
        { status: 400 },
      );
    }
    // For HAND_FORMAL, when the client picks (or changes) the contact,
    // resolve the canonical name from it so the denormalised `lender`
    // column stays in sync. Picking a contact wins over any free-text
    // `lender` the client also sent.
    let resolvedLenderName: string | null = null;
    if (loan.source === "HAND_FORMAL" && data.lenderContactId) {
      const contact = await prisma.contact.findUnique({
        where: { id: data.lenderContactId },
      });
      if (!contact || contact.workspaceId !== ctx.workspaceId) {
        return NextResponse.json({ error: "Contact not found" }, { status: 404 });
      }
      resolvedLenderName = contact.name;
    }

    // chargeBreakdown handling: undefined → leave alone; null/empty → clear;
    // populated array → set & sum into the `charges` total. Mirrors how the
    // create path normalises the breakdown.
    const breakdown = data.chargeBreakdown;
    const breakdownProvided = breakdown !== undefined;
    const newChargesTotal = breakdownProvided
      ? breakdown && breakdown.length > 0
        ? Math.round(
            breakdown.reduce((s, c) => s + (c.amount || 0), 0) * 100,
          ) / 100
        : 0
      : null;

    // Effective post-update values for the schedule fields. We recompute
    // maturityAt and nextDueDate whenever the client doesn't supply them
    // (the form never does) so changes to startedAt / tenure / frequency /
    // EMI propagate through to the dates instead of leaving them stale.
    const newPrincipalNum = Number(data.principal ?? loan.principal);
    const newOutstandingNum = Number(
      data.outstanding !== undefined ? data.outstanding : loan.outstanding,
    );
    const newFrequency = (data.frequency ?? loan.frequency) as LoanFrequency;
    const newTenure =
      data.tenure !== undefined ? data.tenure : loan.tenure;
    const newRateNum =
      data.interestRate !== undefined
        ? data.interestRate == null
          ? 0
          : Number(data.interestRate)
        : loan.interestRate == null
          ? 0
          : Number(loan.interestRate);
    const explicitEmi =
      data.emiAmount !== undefined
        ? data.emiAmount
        : loan.emiAmount == null
          ? null
          : Number(loan.emiAmount);
    const newEmiNum =
      explicitEmi != null
        ? Number(explicitEmi)
        : newRateNum > 0 && newTenure
          ? calculateEMI(
              newPrincipalNum,
              newRateNum,
              newTenure,
              newFrequency,
            ) || null
          : null;
    const newStartedAt = data.startedAt
      ? new Date(data.startedAt)
      : loan.startedAt;
    const totalMonths =
      newTenure != null ? newTenure * monthsPerCycle(newFrequency) : null;

    // Maturity: explicit string → use it; explicit null → clear; omitted →
    // derive from startedAt + total months (or clear if no tenure).
    const computedMaturity =
      data.maturityAt === undefined
        ? totalMonths
          ? (() => {
              const m = new Date(newStartedAt);
              m.setMonth(m.getMonth() + totalMonths);
              return m;
            })()
          : null
        : data.maturityAt
          ? new Date(data.maturityAt)
          : null;

    // Next due: same fallback, plus the cycles-paid heuristic from create.
    // The CREDIT_CARD_LOAN kind derives its next due from the card's
    // statement + grace period instead of a fixed cycle anniversary.
    // Per-loan overrides win over the linked card values when supplied.
    // Cleared automatically when the loan is paid off.
    const effectiveStatementDate =
      effectiveKind === "CREDIT_CARD_LOAN"
        ? (data.loanStatementDate !== undefined
            ? data.loanStatementDate
            : loan.loanStatementDate) ??
          cardStatement?.statementDate ??
          null
        : null;
    const effectiveGracePeriod =
      effectiveKind === "CREDIT_CARD_LOAN"
        ? (data.loanGracePeriod !== undefined
            ? data.loanGracePeriod
            : loan.loanGracePeriod) ??
          cardStatement?.gracePeriod ??
          0
        : 0;
    const computedNextDueDate =
      newOutstandingNum <= 0
        ? null
        : data.nextDueDate === undefined
          ? effectiveKind === "CREDIT_CARD_LOAN" &&
              effectiveStatementDate != null
            ? nextStatementDueDate(
                new Date(),
                effectiveStatementDate,
                effectiveGracePeriod,
              )
            : newEmiNum && newTenure
              ? (() => {
                  const start = new Date(newStartedAt);
                  let advance = 1;
                  if (
                    newRateNum > 0 &&
                    newOutstandingNum < newPrincipalNum
                  ) {
                    const paid = countPaidEmis(
                      newPrincipalNum,
                      newRateNum,
                      newEmiNum,
                      newTenure,
                      newFrequency,
                      newOutstandingNum,
                    );
                    advance = paid + 1;
                  }
                  return advanceByCycle(start, newFrequency, advance);
                })()
              : null
          : data.nextDueDate
            ? new Date(data.nextDueDate)
            : null;

    const result = await prisma.$transaction(async (tx) => {
      const updatedLoan = await tx.loan.update({
        where: { id },
        data: {
          kind: data.kind ?? loan.kind,
          lender: resolvedLenderName ?? data.lender ?? loan.lender,
          lenderContactId:
            data.lenderContactId !== undefined
              ? data.lenderContactId
              : loan.lenderContactId,
          borrower:
            data.borrower !== undefined ? data.borrower : loan.borrower,
          principal: data.principal ?? loan.principal,
          outstanding: data.outstanding ?? loan.outstanding,
          interestRate:
            data.interestRate !== undefined
              ? data.interestRate
              : loan.interestRate,
          gstOnInterest:
            data.gstOnInterest !== undefined
              ? data.gstOnInterest
              : loan.gstOnInterest,
          emiAmount:
            data.emiAmount !== undefined ? data.emiAmount : loan.emiAmount,
          tenure: data.tenure !== undefined ? data.tenure : loan.tenure,
          frequency: data.frequency ?? loan.frequency,
          charges: breakdownProvided
            ? newChargesTotal && newChargesTotal > 0
              ? newChargesTotal
              : null
            : data.charges !== undefined
              ? data.charges
              : loan.charges,
          chargeBreakdown: breakdownProvided
            ? breakdown && breakdown.length > 0
              ? breakdown
              : Prisma.DbNull
            : undefined,
          accountId:
            data.accountId !== undefined ? data.accountId : loan.accountId,
          cardId: data.cardId !== undefined ? data.cardId : loan.cardId,
          loanAccountNumber:
            effectiveKind !== "CREDIT_CARD_LOAN"
              ? null
              : data.loanAccountNumber !== undefined
                ? data.loanAccountNumber?.trim() || null
                : loan.loanAccountNumber,
          loanStatementDate:
            effectiveKind !== "CREDIT_CARD_LOAN"
              ? null
              : data.loanStatementDate !== undefined
                ? data.loanStatementDate
                : loan.loanStatementDate,
          loanGracePeriod:
            effectiveKind !== "CREDIT_CARD_LOAN"
              ? null
              : data.loanGracePeriod !== undefined
                ? data.loanGracePeriod
                : loan.loanGracePeriod,
          isExisting: newIsExisting,
          startedAt: newStartedAt,
          maturityAt: computedMaturity,
          nextDueDate: computedNextDueDate,
          notes: data.notes !== undefined ? data.notes : loan.notes,
          active: data.active ?? loan.active,
          // Reopening (active flips false → true) clears the closure
          // timestamp so the loan doesn't carry an inconsistent
          // active=true + foreclosedAt=<old date>.
          foreclosedAt:
            !loan.active && data.active === true ? null : loan.foreclosedAt,
        },
      });

      // BANK and HAND_FORMAL loans with isExisting=false carry an auto
      // disbursement INCOME (and BANK additionally an upfront charges
      // EXPENSE) pinned to this loanId. Reconcile those rows against the
      // post-update state — sync amounts when the flag stays off, delete
      // them when the user flips on, recreate them when the user flips
      // off, and leave everything alone otherwise.
      if (loan.source === "BANK" || loan.source === "HAND_FORMAL") {
        const newPrincipal = Number(updatedLoan.principal);
        const newAccountId = updatedLoan.accountId;
        const newDate = updatedLoan.startedAt;
        const newCharges = updatedLoan.charges
          ? Number(updatedLoan.charges)
          : 0;
        const labelList =
          breakdownProvided && breakdown && breakdown.length > 0
            ? breakdown.map((c) => c.label).join(", ")
            : "Processing & other charges";
        const wantAutoTxns = !newIsExisting;
        const disbursementDescription =
          loan.source === "HAND_FORMAL"
            ? `Hand loan from ${updatedLoan.lender}`
            : `Loan disbursement · ${updatedLoan.lender}`;

        const disbursement = await tx.transaction.findFirst({
          where: {
            loanId: id,
            type: TransactionType.INCOME,
            kind: TransactionKind.LOAN_PAYMENT,
          },
          orderBy: { createdAt: "asc" },
        });
        if (wantAutoTxns) {
          if (disbursement) {
            await tx.transaction.update({
              where: { id: disbursement.id },
              data: {
                amount: newPrincipal,
                date: newDate,
                accountId: newAccountId,
                description: disbursementDescription,
              },
            });
          } else if (newAccountId) {
            await tx.transaction.create({
              data: {
                workspaceId: ctx.workspaceId,
                type: TransactionType.INCOME,
                kind: TransactionKind.LOAN_PAYMENT,
                amount: newPrincipal,
                description: disbursementDescription,
                date: newDate,
                accountId: newAccountId,
                loanId: id,
                userId: ctx.userId,
                createdByUserId: ctx.userId,
              },
            });
          }
        } else if (disbursement) {
          await tx.transaction.delete({ where: { id: disbursement.id } });
        }

        // Upfront charges only exist on BANK loans — skip the lookup
        // entirely for HAND_FORMAL so we don't accidentally delete an
        // unrelated OTHER_EXPENSE that happens to share the loanId.
        if (loan.source === "BANK") {
          const chargeTxn = await tx.transaction.findFirst({
            where: {
              loanId: id,
              type: TransactionType.EXPENSE,
              kind: TransactionKind.OTHER_EXPENSE,
            },
            orderBy: { createdAt: "asc" },
          });
          if (wantAutoTxns && newCharges > 0) {
            if (chargeTxn) {
              await tx.transaction.update({
                where: { id: chargeTxn.id },
                data: {
                  amount: newCharges,
                  date: newDate,
                  accountId: newAccountId,
                  description: `Loan charges · ${updatedLoan.lender} · ${labelList}`,
                },
              });
            } else if (newAccountId) {
              await tx.transaction.create({
                data: {
                  workspaceId: ctx.workspaceId,
                  type: TransactionType.EXPENSE,
                  kind: TransactionKind.OTHER_EXPENSE,
                  amount: newCharges,
                  description: `Loan charges · ${updatedLoan.lender} · ${labelList}`,
                  date: newDate,
                  accountId: newAccountId,
                  loanId: id,
                  userId: ctx.userId,
                  createdByUserId: ctx.userId,
                },
              });
            }
          } else if (chargeTxn) {
            await tx.transaction.delete({ where: { id: chargeTxn.id } });
          }
        }
      }

      // Gold items: replace-all when the client sends a fresh list. Also
      // wipe stale rows when kind moves away from GOLD even if the client
      // didn't send goldItems.
      const newKind = data.kind ?? loan.kind;
      if (data.goldItems !== undefined) {
        await tx.goldLoanItem.deleteMany({ where: { loanId: id } });
        if (data.goldItems.length > 0 && newKind === "GOLD") {
          await tx.goldLoanItem.createMany({
            data: data.goldItems.map((g) => ({
              loanId: id,
              name: g.name,
              quantity: g.quantity ?? 1,
              weightGrams: g.weightGrams,
              purity: g.purity ?? null,
              notes: g.notes ?? null,
            })),
          });
        }
      } else if (loan.kind === "GOLD" && newKind !== "GOLD") {
        await tx.goldLoanItem.deleteMany({ where: { loanId: id } });
      }

      return updatedLoan;
    });

    return NextResponse.json({ id: result.id });
  } catch (e) {
    return err(e);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const loan = await prisma.loan.findUnique({ where: { id } });
    if (!loan) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const ctx = await requireWorkspace(featureForSource(loan.source), "write");
    const session = await auth();
    if (loan.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!canModifyRecord(session, loan)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    // Loans with any payment history (active or closed) cannot be
    // deleted — the linked transactions would either cascade away
    // (losing real money movement) or dangle. Closed loans are
    // permanently locked: there's no "archive" toggle to flip back to.
    const txCount = await prisma.transaction.count({ where: { loanId: id } });
    if (txCount > 0) {
      return NextResponse.json(
        {
          error: loan.active
            ? "Loan has payment history — archive (active=false) instead."
            : "Loan is closed and locked. Delete the closing EMI within its grace window to re-open the loan first.",
        },
        { status: 400 },
      );
    }
    await prisma.$transaction(async (tx) => {
      await archiveAttachmentsForOwner({
        workspaceId: ctx.workspaceId,
        ownerKind: "LOAN_DOCUMENT",
        ownerId: id,
        userId: ctx.userId,
        tx,
      });
      await tx.loan.delete({ where: { id } });
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}
