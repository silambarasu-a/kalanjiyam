import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { canAccessRecord, canModifyRecord } from "@/lib/permissions";
import { loanUpdateSchema } from "@/lib/validators-domain";
import {
  Prisma,
  LoanLedgerKind,
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
import { nextInterestDueDate } from "@/lib/hand-loan-interest";
import { counterpartyName } from "@/lib/loan-direction";
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
        borrowerContact: { select: { id: true, name: true } },
        memberContact: { select: { id: true, name: true, relationship: true } },
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
    const [payments, ledger] = await Promise.all([
      prisma.transaction.findMany({
        where: { loanId: id },
        orderBy: { date: "desc" },
        take: 50,
      }),
      prisma.loanLedgerEntry.findMany({
        where: { loanId: id },
        orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
        take: 100,
      }),
    ]);
    return NextResponse.json({
      loan: {
        id: loan.id,
        kind: loan.kind,
        source: loan.source,
        direction: loan.direction,
        repaymentMode: loan.repaymentMode,
        lender: loan.lenderContact?.name ?? loan.lender,
        counterparty: counterpartyName(loan),
        lenderContact: loan.lenderContact,
        borrower: loan.borrower,
        borrowerContact: loan.borrowerContact,
        memberContactId: loan.memberContactId,
        memberContact: loan.memberContact,
        principal: Number(loan.principal),
        outstanding: Number(loan.outstanding),
        interestRate: loan.interestRate == null ? null : Number(loan.interestRate),
        gstOnInterest: loan.gstOnInterest == null ? null : Number(loan.gstOnInterest),
        emiAmount: loan.emiAmount == null ? null : Number(loan.emiAmount),
        tenure: loan.tenure,
        frequency: loan.frequency,
        interestCadence: loan.interestCadence,
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
      ledger: ledger.map((e) => ({
        id: e.id,
        kind: e.kind,
        principalAmount: Number(e.principalAmount),
        interestAmount: Number(e.interestAmount),
        gstAmount: Number(e.gstAmount),
        amount: Number(e.amount),
        paidAt: e.paidAt.toISOString(),
        periodFrom: e.periodFrom?.toISOString() ?? null,
        periodTo: e.periodTo?.toISOString() ?? null,
        transactionId: e.transactionId,
        notes: e.notes,
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

    // If a member (family-member contact) is being set, it must belong to
    // this workspace.
    if (data.memberContactId) {
      const memberOk = await prisma.contact.count({
        where: { id: data.memberContactId, workspaceId: ctx.workspaceId },
      });
      if (!memberOk) {
        return NextResponse.json({ error: "Member not found" }, { status: 404 });
      }
    }

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
    // Direction and repayment mode are equally fixed once cash has moved.
    // Flipping direction would invert the sign of every transaction already
    // posted against the loan; flipping the mode would leave an EMI schedule
    // pointing at ad-hoc entries or vice versa.
    if (data.direction && data.direction !== loan.direction) {
      return NextResponse.json(
        { error: "Cannot change loan direction" },
        { status: 400 }
      );
    }
    if (data.repaymentMode && data.repaymentMode !== loan.repaymentMode) {
      return NextResponse.json(
        { error: "Cannot change how this loan is settled" },
        { status: 400 }
      );
    }
    const isLent = loan.direction === "LENT";
    const isAdHoc = loan.repaymentMode === "AD_HOC";
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

    // lenderContactId is only meaningful for a BORROWED HAND_FORMAL loan —
    // reject the field outright elsewhere so a stray client (or future bug)
    // can't attach a contact to a bank loan, or put a lent loan on the wrong
    // side of a contact's ledger.
    if (data.lenderContactId !== undefined && loan.source !== "HAND_FORMAL") {
      return NextResponse.json(
        { error: "Lender contact only applies to hand loans" },
        { status: 400 },
      );
    }
    if (data.lenderContactId !== undefined && isLent) {
      return NextResponse.json(
        { error: "Lender contact only applies to money you borrowed" },
        { status: 400 },
      );
    }
    if (data.borrowerContactId !== undefined && !isLent) {
      return NextResponse.json(
        { error: "Borrower contact only applies to money you lent" },
        { status: 400 },
      );
    }
    // When the client picks (or changes) the counterparty, resolve the
    // canonical name from the contact so the denormalised column stays in sync.
    // Picking a contact wins over any free-text name the client also sent.
    const pickedContactId = isLent ? data.borrowerContactId : data.lenderContactId;
    let resolvedLenderName: string | null = null;
    let resolvedBorrowerName: string | null = null;
    if (loan.source === "HAND_FORMAL" && pickedContactId) {
      const contact = await prisma.contact.findFirst({
        where: { id: pickedContactId, workspaceId: ctx.workspaceId },
        select: { name: true },
      });
      if (!contact) {
        return NextResponse.json({ error: "Contact not found" }, { status: 404 });
      }
      // On a lent loan the borrower's name is mirrored into `lender` too, for
      // the same reason as on create: `lender` is what the not-yet-migrated
      // label sites read.
      resolvedLenderName = contact.name;
      if (isLent) resolvedBorrowerName = contact.name;
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
    // An AD_HOC loan is pinned to MONTHLY so its `tenure` is a plain month
    // count (see the create path) — never let an update knock that loose.
    const newFrequency = (isAdHoc
      ? "MONTHLY"
      : (data.frequency ?? loan.frequency)) as LoanFrequency;
    const newTenure =
      data.tenure !== undefined ? data.tenure : loan.tenure;
    const newInterestCadence = isAdHoc
      ? data.interestCadence !== undefined
        ? data.interestCadence
        : loan.interestCadence
      : null;
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
    // No instalment on an ad-hoc loan — a computed one would make the detail
    // page render a schedule the two parties never agreed to.
    const newEmiNum = isAdHoc
      ? null
      : explicitEmi != null
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

    // For an ad-hoc loan the next settlement is measured from the last one, so
    // editing an unrelated field doesn't reset the collection clock. Prefer the
    // period the settlement covered over the date it was paid.
    const latestSettlement = isAdHoc
      ? await prisma.loanLedgerEntry.findFirst({
          where: { loanId: id, kind: "REPAYMENT", interestAmount: { gt: 0 } },
          orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
          select: { paidAt: true, periodTo: true },
        })
      : null;
    const latestSettlementAt = latestSettlement
      ? (latestSettlement.periodTo ?? latestSettlement.paidAt)
      : null;

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
          ? isAdHoc
            ? // No cycle to advance — the next date is the next interest
              // settlement. Anchored on the latest recorded settlement so
              // editing the loan doesn't reset the collection clock; falls back
              // to the start date for a loan with no history yet.
              nextInterestDueDate(
                latestSettlementAt ?? newStartedAt,
                newInterestCadence,
                computedMaturity,
              )
            : effectiveKind === "CREDIT_CARD_LOAN" &&
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
            resolvedBorrowerName ??
            (data.borrower !== undefined ? data.borrower : loan.borrower),
          borrowerContactId:
            data.borrowerContactId !== undefined
              ? data.borrowerContactId
              : loan.borrowerContactId,
          memberContactId:
            data.memberContactId !== undefined
              ? data.memberContactId
              : loan.memberContactId,
          principal: data.principal ?? loan.principal,
          outstanding: data.outstanding ?? loan.outstanding,
          interestRate:
            data.interestRate !== undefined
              ? data.interestRate
              : loan.interestRate,
          // GST and a fixed EMI don't exist on an ad-hoc hand loan; clamp both
          // server-side so a hand-rolled request can't reintroduce a schedule.
          gstOnInterest: isAdHoc
            ? null
            : data.gstOnInterest !== undefined
              ? data.gstOnInterest
              : loan.gstOnInterest,
          emiAmount: isAdHoc
            ? null
            : data.emiAmount !== undefined
              ? data.emiAmount
              : loan.emiAmount,
          tenure: data.tenure !== undefined ? data.tenure : loan.tenure,
          frequency: newFrequency,
          interestCadence: newInterestCadence,
          charges: isAdHoc
            ? null
            : breakdownProvided
              ? newChargesTotal && newChargesTotal > 0
                ? newChargesTotal
                : null
              : data.charges !== undefined
                ? data.charges
                : loan.charges,
          chargeBreakdown: isAdHoc
            ? Prisma.DbNull
            : breakdownProvided
              ? breakdown && breakdown.length > 0
                ? breakdown
                : Prisma.DbNull
              : undefined,
          accountId:
            data.accountId !== undefined ? data.accountId : loan.accountId,
          cardId: data.cardId !== undefined ? data.cardId : loan.cardId,
          loanAccountNumber:
            data.loanAccountNumber !== undefined
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
        const disbursementType = isLent
          ? TransactionType.EXPENSE
          : TransactionType.INCOME;
        const disbursementDescription = isLent
          ? `Loan given to ${updatedLoan.lender}`
          : loan.source === "HAND_FORMAL"
            ? `Hand loan from ${updatedLoan.lender}`
            : `Loan disbursement · ${updatedLoan.lender}`;

        // Find the disbursement through its ledger entry. Probing on
        // `type: INCOME` would miss a lent loan's EXPENSE disbursement, and the
        // "no row found" branch below would then CREATE A SECOND ONE on every
        // edit. Pre-ledger loans have no entry — fall back to the old probe,
        // which is still correct for them because they are all borrowed.
        const disbursementEntry = await tx.loanLedgerEntry.findFirst({
          where: { loanId: id, kind: LoanLedgerKind.DISBURSEMENT },
          orderBy: { createdAt: "asc" },
        });
        const disbursement = disbursementEntry?.transactionId
          ? await tx.transaction.findUnique({
              where: { id: disbursementEntry.transactionId },
            })
          : disbursementEntry
            ? null
            : await tx.transaction.findFirst({
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
            if (disbursementEntry) {
              await tx.loanLedgerEntry.update({
                where: { id: disbursementEntry.id },
                data: {
                  principalAmount: newPrincipal,
                  amount: newPrincipal,
                  paidAt: newDate,
                },
              });
            }
          } else if (newAccountId) {
            const recreated = await tx.transaction.create({
              data: {
                workspaceId: ctx.workspaceId,
                type: disbursementType,
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
            if (disbursementEntry) {
              await tx.loanLedgerEntry.update({
                where: { id: disbursementEntry.id },
                data: {
                  principalAmount: newPrincipal,
                  amount: newPrincipal,
                  paidAt: newDate,
                  transactionId: recreated.id,
                },
              });
            } else {
              await tx.loanLedgerEntry.create({
                data: {
                  workspaceId: ctx.workspaceId,
                  loanId: id,
                  kind: LoanLedgerKind.DISBURSEMENT,
                  principalAmount: newPrincipal,
                  amount: newPrincipal,
                  paidAt: newDate,
                  transactionId: recreated.id,
                  createdByUserId: ctx.userId,
                },
              });
            }
          }
        } else {
          // Flipped to "already disbursed" — drop the auto cash row AND its
          // ledger entry. Leaving the entry behind (transactionId SetNull) would
          // keep a phantom disbursement in every ledger-derived total.
          if (disbursement) {
            await tx.transaction.delete({ where: { id: disbursement.id } });
          }
          if (disbursementEntry) {
            await tx.loanLedgerEntry.delete({
              where: { id: disbursementEntry.id },
            });
          }
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
          const chargeEntry = await tx.loanLedgerEntry.findFirst({
            where: { loanId: id, kind: LoanLedgerKind.CHARGE },
            orderBy: { createdAt: "asc" },
          });
          const chargeDescription = `Loan charges · ${updatedLoan.lender} · ${labelList}`;
          if (wantAutoTxns && newCharges > 0) {
            let chargeTxnId = chargeTxn?.id ?? null;
            if (chargeTxn) {
              await tx.transaction.update({
                where: { id: chargeTxn.id },
                data: {
                  amount: newCharges,
                  date: newDate,
                  accountId: newAccountId,
                  description: chargeDescription,
                },
              });
            } else if (newAccountId) {
              const created = await tx.transaction.create({
                data: {
                  workspaceId: ctx.workspaceId,
                  type: TransactionType.EXPENSE,
                  kind: TransactionKind.OTHER_EXPENSE,
                  amount: newCharges,
                  description: chargeDescription,
                  date: newDate,
                  accountId: newAccountId,
                  loanId: id,
                  userId: ctx.userId,
                  createdByUserId: ctx.userId,
                },
              });
              chargeTxnId = created.id;
            }
            if (chargeTxnId) {
              if (chargeEntry) {
                await tx.loanLedgerEntry.update({
                  where: { id: chargeEntry.id },
                  data: {
                    amount: newCharges,
                    paidAt: newDate,
                    transactionId: chargeTxnId,
                    notes: labelList,
                  },
                });
              } else {
                await tx.loanLedgerEntry.create({
                  data: {
                    workspaceId: ctx.workspaceId,
                    loanId: id,
                    kind: LoanLedgerKind.CHARGE,
                    amount: newCharges,
                    paidAt: newDate,
                    transactionId: chargeTxnId,
                    notes: labelList,
                    createdByUserId: ctx.userId,
                  },
                });
              }
            }
          } else {
            if (chargeTxn) {
              await tx.transaction.delete({ where: { id: chargeTxn.id } });
            }
            if (chargeEntry) {
              await tx.loanLedgerEntry.delete({ where: { id: chargeEntry.id } });
            }
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
    const loan = await prisma.loan.findUnique({
      where: { id },
      include: { card: { select: { accountId: true } } },
    });
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
    //
    // A cash-in-hand settlement or a write-off leaves a LoanLedgerEntry with no
    // Transaction at all, so counting transactions alone would let a loan with
    // real off-account history be hard-deleted (LoanLedgerEntry cascades on
    // loanId, so the history would vanish silently). Count both. The
    // DISBURSEMENT entry is excluded because it always has a transaction of its
    // own, already covered by txCount, and a loan whose only entry is its
    // disbursement is still legitimately deletable.
    const [txCount, entryCount] = await Promise.all([
      prisma.transaction.count({ where: { loanId: id } }),
      prisma.loanLedgerEntry.count({
        where: { loanId: id, kind: { not: "DISBURSEMENT" } },
      }),
    ]);
    if (txCount > 0 || entryCount > 0) {
      return NextResponse.json(
        {
          error: loan.active
            ? "Loan has payment history — archive (active=false) instead."
            : "Loan is closed and locked. Delete the closing payment within its grace window to re-open the loan first.",
        },
        { status: 400 },
      );
    }
    // Undo any CARD_EMI reconciliation: the principal we moved out of the
    // card's outstanding when the EMI was added goes back, so the card's
    // available limit returns to what it was before the EMI existed.
    const cardLimitOffset = Number(loan.cardLimitOffset ?? 0);
    await prisma.$transaction(async (tx) => {
      await archiveAttachmentsForOwner({
        workspaceId: ctx.workspaceId,
        ownerKind: "LOAN_DOCUMENT",
        ownerId: id,
        userId: ctx.userId,
        tx,
      });
      if (loan.source === "CARD_EMI" && cardLimitOffset > 0 && loan.card?.accountId) {
        await tx.account.update({
          where: { id: loan.card.accountId },
          data: { openingBalance: { increment: cardLimitOffset } },
        });
      }
      await tx.loan.delete({ where: { id } });
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}
