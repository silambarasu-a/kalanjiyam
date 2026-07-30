import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import {
  canAccessRecord,
  checkRoutePermission,
  visibilityFilter,
} from "@/lib/permissions";
import { loanCreateSchema } from "@/lib/validators-domain";
import { calculateEMI, countPaidEmis, monthsPerCycle, advanceByCycle } from "@/lib/loan-math";
import { nextInterestDueDate } from "@/lib/hand-loan-interest";
import { counterpartyName } from "@/lib/loan-direction";
import { nextStatementDueDate } from "@/lib/statement-period";
import { computeAccountBalance } from "@/lib/account-balance";
import {
  LoanKind,
  LoanSource,
  LoanFrequency,
  LoanDirection,
  LoanRepaymentMode,
  LoanInterestCadence,
  LoanLedgerKind,
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

/**
 * Look up the hand-loan counterparty and confirm it belongs to this workspace.
 * Returns null when no id was supplied (legacy hand loans carry only the
 * free-text name) and the "not-found" sentinel when the id is bogus or
 * cross-workspace, so the caller can 404.
 */
async function resolveWorkspaceContact(
  workspaceId: string,
  contactId: string | null | undefined,
): Promise<{ id: string; name: string } | null | "not-found"> {
  if (!contactId) return null;
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, workspaceId },
    select: { id: true, name: true },
  });
  return contact ?? "not-found";
}

const ALL_SOURCES = ["BANK", "HAND_FORMAL", "CARD_EMI"] as const;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const source = url.searchParams.get("source") as LoanSource | null;
    const direction = url.searchParams.get("direction") as LoanDirection | null;
    // Loans are permission-gated per source, so a source-less list must not
    // leak across features. It used to check `bank_loans` and then return loans
    // of EVERY source, so a member with bank_loans:full + hand_loans:hidden
    // could read hand loans through it. Now we resolve which sources the caller
    // can actually read and filter to those. `dashboard` on the source-less
    // path only establishes the workspace — the per-source filter below is what
    // does the real gating.
    const ctx = await requireWorkspace(
      source ? featureForSource(source) : "dashboard",
      "read",
    );
    const session = await auth();

    // With an explicit `source`, requireWorkspace above already gated it and
    // ctx.ownOnly is the correct visibility scope. Without one we have to gate
    // AND scope each source independently — a member can hold a different level
    // on each of bank_loans / hand_loans / card_emi, so one shared ownOnly
    // would be wrong for at least one of them.
    const scope = source
      ? { source, ...visibilityFilter(session, ctx.ownOnly) }
      : (() => {
          const branches = ALL_SOURCES.map((s) => {
            const perm = checkRoutePermission(session, featureForSource(s), "read");
            return perm.allowed
              ? { source: s, ...visibilityFilter(session, perm.ownOnly) }
              : null;
          }).filter((b): b is NonNullable<typeof b> => b !== null);
          return branches.length ? { OR: branches } : null;
        })();
    // No readable source at all — an empty list, not a 403: the caller does
    // hold `dashboard` read, there is just nothing here for them.
    if (!scope) return NextResponse.json({ loans: [] });

    const loans = await prisma.loan.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        ...scope,
        ...(direction ? { direction } : {}),
      },
      orderBy: [{ active: "desc" }, { startedAt: "desc" }],
      include: {
        ownerUser: { select: { id: true, name: true } },
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
    // Interest settled per loan, in one groupBy rather than N+1 per row. Only
    // loans with ledger entries appear; the rest report 0, which is all that
    // was ever knowable for pre-ledger history.
    const interestByLoan = new Map<string, number>();
    if (loans.length > 0) {
      const sums = await prisma.loanLedgerEntry.groupBy({
        by: ["loanId"],
        where: { loanId: { in: loans.map((l) => l.id) }, kind: "REPAYMENT" },
        _sum: { interestAmount: true, gstAmount: true },
      });
      for (const s of sums) {
        interestByLoan.set(
          s.loanId,
          Number(s._sum.interestAmount ?? 0) + Number(s._sum.gstAmount ?? 0),
        );
      }
    }

    return NextResponse.json({
      loans: loans.map((l) => ({
        id: l.id,
        kind: l.kind,
        source: l.source,
        direction: l.direction,
        repaymentMode: l.repaymentMode,
        // Always serve the contact's *current* name when one is linked,
        // falling back to the denormalised string for legacy/bank loans.
        // `lender` is kept for the existing consumers; `counterparty` is what
        // new code should read, since on a lent loan the other party is the
        // borrower.
        lender: l.lenderContact?.name ?? l.lender,
        counterparty: counterpartyName(l),
        lenderContact: l.lenderContact,
        borrower: l.borrower,
        borrowerContact: l.borrowerContact,
        memberContactId: l.memberContactId,
        memberContact: l.memberContact,
        principal: Number(l.principal),
        outstanding: Number(l.outstanding),
        interestSettled: interestByLoan.get(l.id) ?? 0,
        interestRate: l.interestRate == null ? null : Number(l.interestRate),
        gstOnInterest: l.gstOnInterest == null ? null : Number(l.gstOnInterest),
        emiAmount: l.emiAmount == null ? null : Number(l.emiAmount),
        tenure: l.tenure,
        frequency: l.frequency,
        interestCadence: l.interestCadence,
        charges: l.charges == null ? null : Number(l.charges),
        chargeBreakdown: l.chargeBreakdown ?? null,
        account: l.account,
        card: l.card,
        loanAccountNumber: l.loanAccountNumber,
        loanStatementDate: l.loanStatementDate,
        loanGracePeriod: l.loanGracePeriod,
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

    // For CREDIT_CARD_LOAN we also need the card's linked account so we can
     // read the statementDate / gracePeriod for billing-cycle math.
    let cardStatement: { statementDate: number | null; gracePeriod: number | null } | null = null;
    let cardAccountId: string | null = null;
    if (data.cardId) {
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
      cardAccountId = card.accountId ?? null;
      cardStatement = card.account
        ? {
            statementDate: card.account.statementDate,
            gracePeriod: card.account.gracePeriod,
          }
        : null;
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

    const isLent = data.direction === "LENT";
    const isAdHoc = data.repaymentMode === "AD_HOC";

    // Direction / mode are only meaningful on hand loans. The Zod refines
    // already cover this, but a hand-rolled request must not be able to reach
    // the ledger-writing code below with an impossible combination.
    if (isLent && data.source !== "HAND_FORMAL") {
      return NextResponse.json(
        { error: "Only hand loans can be money you lent out" },
        { status: 400 },
      );
    }
    if (isAdHoc && data.source !== "HAND_FORMAL") {
      return NextResponse.json(
        { error: "Only hand loans can be settled as you go" },
        { status: 400 },
      );
    }
    // lenderContactId only applies to a BORROWED HAND_FORMAL loan. Reject so a
    // bad client can't attach a contact to a bank/card-EMI loan, or put a lent
    // loan on the wrong side of a contact's ledger.
    if (data.lenderContactId && data.source !== "HAND_FORMAL") {
      return NextResponse.json(
        { error: "Lender contact only applies to hand loans" },
        { status: 400 },
      );
    }
    if (data.lenderContactId && isLent) {
      return NextResponse.json(
        { error: "Lender contact only applies to money you borrowed" },
        { status: 400 },
      );
    }
    if (data.borrowerContactId && !isLent) {
      return NextResponse.json(
        { error: "Borrower contact only applies to money you lent" },
        { status: 400 },
      );
    }
    // For HAND_FORMAL, the counterparty is a workspace contact. Resolve the
    // name from the contact so the denormalised column always matches — ignore
    // whatever string the client sent.
    const counterpartyContact =
      data.source === "HAND_FORMAL"
        ? await resolveWorkspaceContact(
            ctx.workspaceId,
            isLent ? data.borrowerContactId : data.lenderContactId,
          )
        : null;
    if (counterpartyContact === "not-found") {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }

    let resolvedLenderName = data.lender;
    let resolvedLenderContactId: string | null = null;
    let resolvedBorrowerName = data.borrower ?? null;
    let resolvedBorrowerContactId: string | null = null;
    if (counterpartyContact) {
      if (isLent) {
        resolvedBorrowerName = counterpartyContact.name;
        resolvedBorrowerContactId = counterpartyContact.id;
        // `lender` is NOT NULL and read directly by the label sites that
        // haven't been switched to counterpartyName() yet (dashboard dues,
        // reports, recent activity). Storing the borrower's name there keeps
        // all of them rendering the right human instead of a stale "you".
        resolvedLenderName = counterpartyContact.name;
      } else {
        resolvedLenderName = counterpartyContact.name;
        resolvedLenderContactId = counterpartyContact.id;
      }
    }

    // memberContactId: the family member (workspace contact) whose name /
    // account the loan is under. Any source can set it. Verify it belongs to
    // this workspace.
    if (data.memberContactId) {
      const memberOk = await prisma.contact.count({
        where: { id: data.memberContactId, workspaceId: ctx.workspaceId },
      });
      if (!memberOk) {
        return NextResponse.json({ error: "Member not found" }, { status: 404 });
      }
    }

    // tenure is the number of payment cycles (months for MONTHLY,
    // quarters for QUARTERLY, etc.). Convert to total months for the
    // maturity date math.
    //
    // AD_HOC loans have no EMI cycle to size, so `frequency` is pinned to
    // MONTHLY and `tenure` therefore *is* a month count — that's what lets the
    // form label it "Term (months)". Clamped here rather than only in the form
    // so a hand-rolled request can't create a quarterly-cycle ad-hoc loan whose
    // tenure then silently means something else.
    const frequency = isAdHoc ? "MONTHLY" : (data.frequency ?? "MONTHLY");
    const tenureCycles = data.tenure ?? null;
    const totalMonths =
      tenureCycles != null ? tenureCycles * monthsPerCycle(frequency) : null;

    // Server-side fallback: if the client didn't send an explicit emiAmount
    // but we have principal + rate + tenure, compute the standard
    // reducing-balance EMI so every loan has a numeric EMI on file. An AD_HOC
    // loan has no instalment at all — a computed one would make the UI render a
    // schedule the two parties never agreed to.
    const computedEmi = isAdHoc
      ? null
      : (data.emiAmount ??
        (data.interestRate != null && tenureCycles
          ? calculateEMI(data.principal, data.interestRate, tenureCycles, frequency) || null
          : null));

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

    // First due date.
    //
    // For most loans this is `startedAt + 1 cycle`, advanced past any
    // already-paid cycles for `isExisting` loans.
    //
    // The CREDIT_CARD_LOAN kind is repaid through the linked card's
    // monthly statement, so the next due date is the next statement DUE
    // DATE on/after `startedAt` (or "today" for an existing partly-paid
    // loan) — the most recently closed statement, still within its grace
    // window, counts as the upcoming due, so this lands one cycle earlier
    // than "next close + grace". Not a fixed monthly anniversary. Per-loan
    // overrides win over the linked card's account values (handles the
    // HDFC AAN case where the loan bills on its own cycle, and the case
    // where the linked card has no statementDate configured).
    const effectiveStatementDate =
      data.kind === "CREDIT_CARD_LOAN"
        ? (data.loanStatementDate ?? cardStatement?.statementDate ?? null)
        : null;
    const effectiveGracePeriod =
      data.kind === "CREDIT_CARD_LOAN"
        ? (data.loanGracePeriod ?? cardStatement?.gracePeriod ?? 0)
        : 0;
    const computedNextDueDate =
      data.nextDueDate
        ? new Date(data.nextDueDate)
        : isAdHoc
          ? // No EMI schedule to advance — the next date is the next interest
            // settlement, one cadence out (or the maturity date for
            // AT_MATURITY). Null when the loan charges no interest, and it then
            // simply never comes up as due.
            nextInterestDueDate(
              new Date(data.startedAt),
              data.interestCadence ?? null,
              computedMaturity,
            )
          : data.kind === "CREDIT_CARD_LOAN" && effectiveStatementDate != null
          ? nextStatementDueDate(
              data.isExisting ? new Date() : new Date(data.startedAt),
              effectiveStatementDate,
              effectiveGracePeriod,
            )
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
    // deduct upfront — processing fee, GST, stamp duty, insurance, etc. Never
    // applies to an ad-hoc hand loan.
    const breakdown = isAdHoc ? [] : (data.chargeBreakdown ?? []);
    const chargesTotal = isAdHoc
      ? 0
      : breakdown.length
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

    // CARD_EMI reconciliation. An existing card EMI's outstanding is already
    // sitting in the linked card's statement balance (the user entered it as
    // the card's "Existing outstanding"), so it's *already* reducing the
    // card's available limit. Move that principal out of the card's
    // outstanding into this loan (the EMI bucket) so the limit isn't
    // double-counted — and so future EMI payments, which shrink the loan,
    // free the limit back up. Capped at the card's current balance so we
    // never push it negative or reclaim unrelated revolving spend. The moved
    // amount is recorded on the loan (cardLimitOffset) so it can be restored
    // if the EMI is deleted.
    let cardLimitOffset = 0;
    let cardOpeningAfter: number | null = null;
    if (
      data.source === "CARD_EMI" &&
      cardAccountId &&
      !isAlreadyPaid &&
      initialOutstanding > 0
    ) {
      const bal = await computeAccountBalance(cardAccountId);
      cardLimitOffset = Math.min(initialOutstanding, Math.max(0, bal.balance));
      if (cardLimitOffset > 0) {
        cardOpeningAfter =
          Math.round((bal.openingBalance - cardLimitOffset) * 100) / 100;
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const loan = await tx.loan.create({
        data: {
          workspaceId: ctx.workspaceId,
          ownerUserId: ctx.userId,
          kind: data.kind as LoanKind,
          source: data.source as LoanSource,
          direction: data.direction as LoanDirection,
          repaymentMode: data.repaymentMode as LoanRepaymentMode,
          lender: resolvedLenderName,
          lenderContactId: resolvedLenderContactId,
          borrower: resolvedBorrowerName,
          borrowerContactId: resolvedBorrowerContactId,
          memberContactId: data.memberContactId ?? null,
          principal: data.principal,
          outstanding: initialOutstanding,
          interestRate: data.interestRate ?? null,
          // GST on interest is a card-EMI construct; private lending has none.
          gstOnInterest: isAdHoc ? null : data.gstOnInterest ?? null,
          emiAmount: computedEmi,
          tenure: data.tenure ?? null,
          frequency: frequency as LoanFrequency,
          interestCadence: isAdHoc
            ? ((data.interestCadence ?? null) as LoanInterestCadence | null)
            : null,
          charges: chargesTotal > 0 ? chargesTotal : null,
          chargeBreakdown: breakdown.length ? breakdown : undefined,
          accountId: data.accountId ?? null,
          cardId: data.cardId ?? null,
          // The loan account number applies to every loan kind (bank loan
          // a/c, NBFC ref, or — for card loans — the AAN).
          loanAccountNumber: data.loanAccountNumber?.trim() || null,
          loanStatementDate:
            data.kind === "CREDIT_CARD_LOAN"
              ? data.loanStatementDate ?? null
              : null,
          loanGracePeriod:
            data.kind === "CREDIT_CARD_LOAN"
              ? data.loanGracePeriod ?? null
              : null,
          isExisting: data.isExisting ?? false,
          cardLimitOffset,
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

      // Apply the CARD_EMI reconciliation: shrink the linked card account's
      // outstanding by the moved principal so it now lives only in this loan.
      if (cardOpeningAfter != null && cardAccountId) {
        await tx.account.update({
          where: { id: cardAccountId },
          data: { openingBalance: cardOpeningAfter },
        });
      }

      // Disbursement — the full principal moves through the chosen account.
      //
      // BORROWED: credited IN. Applies to both BANK loans (passbook credit
      // from the bank) and HAND_FORMAL loans (cash from a contact deposited
      // into a bank account).
      //
      // LENT: the mirror image — it leaves the account, because you handed the
      // money over. Never TransactionType.HAND_LOAN: computeAccountBalance only
      // aggregates INCOME / EXPENSE / TRANSFER, so a HAND_LOAN row would be
      // invisible to every balance in the app.
      //
      // Upfront charges only apply to BANK loans (processing fee, stamp duty,
      // GST, insurance, etc.) and post as a separate EXPENSE so the net account
      // change is (principal − charges).
      if (
        !data.isExisting &&
        (data.source === "BANK" || data.source === "HAND_FORMAL") &&
        data.accountId
      ) {
        const disbursementTxn = await tx.transaction.create({
          data: {
            workspaceId: ctx.workspaceId,
            type: isLent ? TransactionType.EXPENSE : TransactionType.INCOME,
            kind: TransactionKind.LOAN_PAYMENT,
            amount: data.principal,
            description: isLent
              ? `Loan given to ${resolvedLenderName}`
              : data.source === "HAND_FORMAL"
                ? `Hand loan from ${resolvedLenderName}`
                : `Loan disbursement · ${resolvedLenderName}`,
            date: new Date(data.startedAt),
            accountId: data.accountId,
            loanId: loan.id,
            userId: ctx.userId,
            createdByUserId: ctx.userId,
            // Deliberately NOT setting paidByContactId / beneficiaryContactId.
            // paidByContactId on an EXPENSE makes the row surface in the contact
            // ledger's `paidForMe` list ("they paid an expense for me"), the
            // opposite of what a loan you gave out means. The loan →
            // borrowerContact link is the correct join.
          },
        });
        // Tag the disbursement in the ledger. This is what lets every reader
        // identify it without the `type === INCOME && kind === LOAN_PAYMENT`
        // heuristic, which inverts once loans can run the other way.
        await tx.loanLedgerEntry.create({
          data: {
            workspaceId: ctx.workspaceId,
            loanId: loan.id,
            kind: LoanLedgerKind.DISBURSEMENT,
            principalAmount: data.principal,
            amount: data.principal,
            paidAt: new Date(data.startedAt),
            transactionId: disbursementTxn.id,
            createdByUserId: ctx.userId,
          },
        });

        if (data.source === "BANK" && chargesTotal > 0) {
          const chargeLabel =
            breakdown.length > 0
              ? breakdown.map((c) => c.label).join(", ")
              : "Processing & other charges";
          const chargesTxn = await tx.transaction.create({
            data: {
              workspaceId: ctx.workspaceId,
              type: TransactionType.EXPENSE,
              kind: TransactionKind.OTHER_EXPENSE,
              amount: chargesTotal,
              description: `Loan charges · ${resolvedLenderName} · ${chargeLabel}`,
              date: new Date(data.startedAt),
              accountId: data.accountId,
              loanId: loan.id,
              userId: ctx.userId,
              createdByUserId: ctx.userId,
            },
          });
          // Charges are neither principal nor interest — they move cash but
          // never touch `outstanding`, so all three split columns stay 0 and
          // only `amount` carries the figure.
          await tx.loanLedgerEntry.create({
            data: {
              workspaceId: ctx.workspaceId,
              loanId: loan.id,
              kind: LoanLedgerKind.CHARGE,
              amount: chargesTotal,
              paidAt: new Date(data.startedAt),
              transactionId: chargesTxn.id,
              notes: chargeLabel,
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
