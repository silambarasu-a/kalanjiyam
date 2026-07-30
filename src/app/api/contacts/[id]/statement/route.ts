import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";

/**
 * Per-contact financial statement.
 *
 * Unifies every money interaction with one contact into a single,
 * time-filterable ledger plus the aggregates a professional statement
 * needs: monthly cash in/out, a running net-cash line, opening / closing
 * balances, and the standing outstanding position.
 *
 * Query params: `from` / `to` (yyyy-mm-dd, inclusive). Both optional —
 * omit for all-time. The heavy lifting is done in memory over the whole
 * history (household-scale volumes) so opening balances before the window
 * are exact.
 *
 * Event sourcing mirrors the contact ledger route exactly, so the two
 * views never disagree:
 *   - Transfers            → CASH  (money actually moved to / from them)
 *   - Settlements          → CASH  (a charge was paid down)
 *   - MemberCharges        → ACCRUAL (an obligation was booked; no cash)
 *   - Non-recoverable splits (spent on them) → INFO
 *   - "They paid for me" (gift / none)       → INFO
 *   - Hand loans (either direction)          → LOAN header + per-entry rows
 * Recoverable splits and recoverable "paid for me" rows are represented by
 * their MemberCharge (ACCRUAL) instead, so nothing is double-counted.
 *
 * Loan cash comes from the LoanLedgerEntry rows that carry a `transactionId` —
 * the only ones where money actually left or entered an account. The per-loan
 * header row is always cashDelta 0, so the principal is never counted twice.
 * Entries with no transaction (cash-in-hand settlements, write-offs, isExisting
 * disbursements) are informational. Loans with no entries at all predate the
 * ledger and keep exactly the old single-header-row behaviour, so historical
 * statements don't shift.
 */

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[contact-statement]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

const round2 = (n: number) => Math.round(n * 100) / 100;

type EventGroup = "CASH" | "ACCRUAL" | "INFO" | "LOAN";
type Direction = "IN" | "OUT" | "NEUTRAL";

type BuiltEvent = {
  id: string;
  ts: number;
  date: string;
  type: string;
  group: EventGroup;
  label: string;
  description: string;
  account: string | null;
  amount: number;
  direction: Direction;
  cashDelta: number;
  runningCash: number;
  transactionId: string | null;
  loanId: string | null;
  /** Secondary line shown for rows with no cash column (obligations,
   *  informational). Null for cash rows. */
  hint: string | null;
};

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireWorkspace("members", "read");
    const { id } = await context.params;

    const contact = await prisma.contact.findUnique({
      where: { id },
      select: { id: true, name: true, relationship: true, workspaceId: true },
    });
    if (!contact || contact.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const url = new URL(request.url);
    const fromStr = url.searchParams.get("from");
    const toStr = url.searchParams.get("to");
    const from = fromStr ? startOfDay(new Date(fromStr)) : null;
    const to = toStr ? endOfDay(new Date(toStr)) : null;

    const [transfers, charges, spentSplits, paidForMe, loans] =
      await Promise.all([
        prisma.transfer.findMany({
          where: {
            workspaceId: ctx.workspaceId,
            OR: [{ fromContactId: id }, { toContactId: id }],
          },
          include: {
            fromAccount: { select: { name: true } },
            toAccount: { select: { name: true } },
          },
        }),
        prisma.memberCharge.findMany({
          where: { workspaceId: ctx.workspaceId, beneficiaryContactId: id },
          include: {
            originSplit: {
              select: {
                transaction: {
                  select: { id: true, description: true, date: true, type: true },
                },
              },
            },
            settlements: {
              select: {
                id: true,
                amount: true,
                paidAt: true,
                notes: true,
                transactionId: true,
              },
            },
          },
        }),
        // Spent-on-behalf expenses NOT being recovered (recoverable shares
        // surface as MemberCharges instead — see file header).
        prisma.transactionSplit.findMany({
          where: {
            workspaceId: ctx.workspaceId,
            contactId: id,
            isRecoverable: false,
            transaction: { type: "EXPENSE" },
          },
          select: {
            id: true,
            amount: true,
            transaction: {
              select: {
                id: true,
                date: true,
                description: true,
                memberChargeType: true,
                account: { select: { name: true } },
                card: { select: { name: true } },
              },
            },
          },
        }),
        // Expenses this contact paid for the owner. Recoverable rows are
        // mirrored as a USER_OWES charge above, so only gift / none rows
        // are informational here.
        prisma.transaction.findMany({
          where: {
            workspaceId: ctx.workspaceId,
            paidByContactId: id,
            type: "EXPENSE",
            memberChargeType: { not: "RECOVERABLE" },
          },
          select: {
            id: true,
            amount: true,
            date: true,
            description: true,
            memberChargeType: true,
          },
        }),
        prisma.loan.findMany({
          where: {
            workspaceId: ctx.workspaceId,
            OR: [{ lenderContactId: id }, { borrowerContactId: id }],
          },
          select: {
            id: true,
            kind: true,
            direction: true,
            principal: true,
            outstanding: true,
            startedAt: true,
            active: true,
            ledgerEntries: {
              select: {
                id: true,
                kind: true,
                principalAmount: true,
                interestAmount: true,
                gstAmount: true,
                amount: true,
                paidAt: true,
                periodFrom: true,
                periodTo: true,
                transactionId: true,
                notes: true,
              },
            },
          },
        }),
      ]);

    const events: BuiltEvent[] = [];

    // ── Transfers (cash) ────────────────────────────────────────────────
    for (const t of transfers) {
      const isIn = t.fromContactId === id; // they sent → money in
      const amount = Number(t.amount);
      events.push({
        id: `transfer:${t.id}`,
        ts: t.date.getTime(),
        date: t.date.toISOString(),
        type: isIn ? "TRANSFER_IN" : "TRANSFER_OUT",
        group: "CASH",
        label: isIn ? "Transfer received" : "Transfer sent",
        description:
          t.notes ??
          (isIn ? `Received from ${contact.name}` : `Sent to ${contact.name}`),
        account: (isIn ? t.toAccount?.name : t.fromAccount?.name) ?? null,
        amount,
        direction: isIn ? "IN" : "OUT",
        cashDelta: isIn ? amount : -amount,
        runningCash: 0,
        transactionId: null,
        loanId: null,
        hint: null,
      });
    }

    // ── Charges + their settlements ─────────────────────────────────────
    // A MemberCharge that came from an EXPENSE the owner paid (recoverable
    // split) is real cash the owner laid out → it belongs in Money out. A
    // charge that came from a Transfer, or is a "you owe them" obligation
    // where the CONTACT spent the cash, moved no owner cash here (the
    // Transfer row already carries it, or it was the contact's money) → it
    // stays informational so nothing is double-counted.
    for (const c of charges) {
      const amount = Number(c.amount);
      const owedToUser = c.direction === "OWED_TO_USER"; // they owe you
      const forgiven = c.status === "WRITTEN_OFF";
      const originTxn = c.originSplit?.transaction ?? null;
      const fromExpense = owedToUser && originTxn?.type === "EXPENSE";
      const chargeDate = originTxn?.date ?? c.createdAt;
      const description =
        originTxn?.description ??
        c.notes ??
        (owedToUser ? "Amount owed to you" : "Amount you owe");

      if (fromExpense) {
        // Owner paid for something recoverable from the contact → cash out.
        events.push({
          id: `charge:${c.id}`,
          ts: chargeDate.getTime(),
          date: chargeDate.toISOString(),
          type: "PAID_FOR_THEM",
          group: "CASH",
          label: forgiven ? "Paid for them · written off" : "Paid for them",
          description,
          account: null,
          amount,
          direction: "OUT",
          cashDelta: -amount,
          runningCash: 0,
          transactionId: originTxn?.id ?? null,
          loanId: null,
          hint: null,
        });
      } else {
        // Obligation only — no owner cash moved on this row.
        events.push({
          id: `charge:${c.id}`,
          ts: chargeDate.getTime(),
          date: chargeDate.toISOString(),
          type: owedToUser ? "CHARGE_OWED_TO_USER" : "CHARGE_USER_OWES",
          group: forgiven ? "INFO" : "ACCRUAL",
          label: forgiven
            ? "Charge forgiven"
            : owedToUser
              ? "They owe you"
              : "You owe them",
          description,
          account: null,
          amount,
          direction: "NEUTRAL",
          cashDelta: 0,
          runningCash: 0,
          transactionId: originTxn?.id ?? null,
          loanId: null,
          hint: forgiven
            ? "written off — no longer owed"
            : owedToUser
              ? "added to what they owe you"
              : "added to what you owe them",
        });
      }

      for (const s of c.settlements) {
        const samt = Number(s.amount);
        const settleIn = owedToUser; // they paid you back
        events.push({
          id: `settlement:${s.id}`,
          ts: s.paidAt.getTime(),
          date: s.paidAt.toISOString(),
          type: settleIn ? "SETTLEMENT_IN" : "SETTLEMENT_OUT",
          group: "CASH",
          label: settleIn ? "Settlement received" : "Settlement paid",
          description:
            s.notes ??
            (settleIn
              ? `${contact.name} paid you back`
              : `You paid ${contact.name}`),
          account: null,
          amount: samt,
          direction: settleIn ? "IN" : "OUT",
          cashDelta: settleIn ? samt : -samt,
          runningCash: 0,
          transactionId: s.transactionId ?? null,
          loanId: null,
          hint: null,
        });
      }
    }

    // ── Spent on them (owner paid, not recovering) → cash out ───────────
    for (const e of spentSplits) {
      const txn = e.transaction;
      const amount = Number(e.amount);
      events.push({
        id: `split:${e.id}`,
        ts: txn.date.getTime(),
        date: txn.date.toISOString(),
        type: "SPENT_ON_THEM",
        group: "CASH",
        label:
          txn.memberChargeType === "GIFT"
            ? "Spent on them · gift"
            : "Spent on them",
        description: txn.description,
        account: (txn.account ?? txn.card)?.name ?? null,
        amount,
        direction: "OUT",
        cashDelta: -amount,
        runningCash: 0,
        transactionId: txn.id,
        loanId: null,
        hint: null,
      });
    }

    // ── They paid for me — gift / none (contact's cash, informational) ──
    for (const p of paidForMe) {
      events.push({
        id: `paidforme:${p.id}`,
        ts: p.date.getTime(),
        date: p.date.toISOString(),
        type: "THEY_PAID",
        group: "INFO",
        label:
          p.memberChargeType === "GIFT" ? "They paid · gift" : "They paid",
        description: p.description,
        account: null,
        amount: Number(p.amount),
        direction: "NEUTRAL",
        cashDelta: 0,
        runningCash: 0,
        transactionId: p.id,
        loanId: null,
        hint: "they paid — no money moved from your accounts",
      });
    }

    // ── Hand loans ──────────────────────────────────────────────────────
    //
    // The per-loan header row is ALWAYS informational (cashDelta 0) so the
    // principal can never be counted twice. Real cash comes from the
    // LoanLedgerEntry rows that carry a `transactionId` — those are the only
    // ones where money actually left or entered an account. Entries with no
    // transaction (cash-in-hand settlements, write-offs, isExisting
    // disbursements) stay informational too.
    //
    // Loans with NO ledger entries at all predate the ledger, so they keep
    // exactly the old single-header-row behaviour and historical statements
    // don't shift.
    let lentOutstanding = 0;
    let borrowedOutstanding = 0;
    let interestReceived = 0;
    let interestPaid = 0;
    for (const l of loans) {
      const isLent = l.direction === "LENT";
      const outstanding = Number(l.outstanding);
      if (l.active) {
        if (isLent) lentOutstanding += outstanding;
        else borrowedOutstanding += outstanding;
      }
      events.push({
        id: `loan:${l.id}`,
        ts: l.startedAt.getTime(),
        date: l.startedAt.toISOString(),
        type: "LOAN",
        group: "LOAN",
        label: `Hand loan · ${l.kind}`,
        description: isLent ? "You lent to them" : "Borrowed from them",
        account: null,
        amount: Number(l.principal),
        direction: "NEUTRAL",
        cashDelta: 0,
        runningCash: 0,
        transactionId: null,
        loanId: l.id,
        hint: l.active
          ? `${formatCompact(outstanding)} still outstanding`
          : "cleared",
      });

      for (const e of l.ledgerEntries) {
        const principal = Number(e.principalAmount);
        const interest = Number(e.interestAmount) + Number(e.gstAmount);
        const amount = Number(e.amount);
        if (e.kind === "REPAYMENT") {
          if (isLent) interestReceived += interest;
          else interestPaid += interest;
        }
        // Money in on a lent loan's repayment and on a borrowed loan's
        // disbursement; out on the mirror cases.
        const isIn =
          e.kind === "REPAYMENT" ? isLent : !isLent;
        const hasCash = e.transactionId != null && amount > 0;
        const parts: string[] = [];
        if (interest > 0) parts.push(`${formatCompact(interest)} interest`);
        if (principal > 0) parts.push(`${formatCompact(principal)} principal`);
        const period =
          e.periodFrom || e.periodTo
            ? ` · covers ${e.periodFrom ? e.periodFrom.toISOString().slice(0, 10) : "?"} → ${
                e.periodTo ? e.periodTo.toISOString().slice(0, 10) : "?"
              }`
            : "";
        events.push({
          id: `loan-entry:${e.id}`,
          ts: e.paidAt.getTime(),
          date: e.paidAt.toISOString(),
          type:
            e.kind === "WRITE_OFF"
              ? "LOAN_WRITE_OFF"
              : e.kind === "REPAYMENT"
                ? isLent
                  ? "LOAN_RECEIPT"
                  : "LOAN_REPAYMENT"
                : isLent
                  ? "LOAN_GIVEN"
                  : "LOAN_TAKEN",
          group: hasCash ? "CASH" : e.kind === "WRITE_OFF" ? "INFO" : "LOAN",
          label:
            e.kind === "WRITE_OFF"
              ? "Written off"
              : e.kind === "REPAYMENT"
                ? isLent
                  ? "Loan receipt"
                  : "Loan payment"
                : isLent
                  ? "Loan given"
                  : "Loan taken",
          description: `${parts.join(" + ") || "—"}${period}${
            e.notes ? ` · ${e.notes}` : ""
          }${hasCash ? "" : " · no account"}`,
          account: null,
          amount: e.kind === "WRITE_OFF" ? principal : amount,
          direction: hasCash ? (isIn ? "IN" : "OUT") : "NEUTRAL",
          cashDelta: hasCash ? (isIn ? amount : -amount) : 0,
          runningCash: 0,
          transactionId: e.transactionId,
          loanId: l.id,
          hint: hasCash
            ? null
            : e.kind === "WRITE_OFF"
              ? "principal cancelled, no cash moved"
              : "settled outside any account",
        });
      }
    }

    // Chronological pass: assign the running net-cash balance to every event.
    events.sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));
    let cash = 0;
    let openingNetCash = 0;
    for (const ev of events) {
      if (from && ev.ts < from.getTime()) openingNetCash += ev.cashDelta;
      cash += ev.cashDelta;
      ev.runningCash = round2(cash);
    }

    const inRange = (ts: number) =>
      (!from || ts >= from.getTime()) && (!to || ts <= to.getTime());
    const rangeEvents = events.filter((e) => inRange(e.ts));

    // ── Period aggregates ───────────────────────────────────────────────
    let received = 0;
    let paid = 0;
    let theyOweYouAdded = 0;
    let youOweThemAdded = 0;
    let settledInPeriod = 0;
    let spentOnThemInPeriod = 0;
    for (const e of rangeEvents) {
      if (e.cashDelta > 0) received += e.cashDelta;
      else if (e.cashDelta < 0) paid += -e.cashDelta;
      if (e.group === "ACCRUAL") {
        if (e.type === "CHARGE_OWED_TO_USER") theyOweYouAdded += e.amount;
        else if (e.type === "CHARGE_USER_OWES") youOweThemAdded += e.amount;
      }
      if (e.type === "SETTLEMENT_IN" || e.type === "SETTLEMENT_OUT")
        settledInPeriod += e.amount;
      if (e.type === "SPENT_ON_THEM") spentOnThemInPeriod += e.amount;
    }
    const closingNetCash = round2(openingNetCash + received - paid);

    // ── Standing outstanding (as of now, all-time) ──────────────────────
    let theyOweYou = 0;
    let youOweThem = 0;
    for (const c of charges) {
      if (c.status === "WRITTEN_OFF") continue;
      const remaining = Number(c.amount) - Number(c.settledAmount);
      if (remaining <= 0) continue;
      if (c.direction === "USER_OWES") youOweThem += remaining;
      else theyOweYou += remaining;
    }

    // ── Monthly buckets for the chart ───────────────────────────────────
    const monthly = buildMonthly(rangeEvents, openingNetCash, from, to);

    return NextResponse.json({
      contact: {
        id: contact.id,
        name: contact.name,
        relationship: contact.relationship,
      },
      range: { from: fromStr, to: toStr },
      summary: {
        received: round2(received),
        paid: round2(paid),
        netCash: round2(received - paid),
        openingNetCash: round2(openingNetCash),
        closingNetCash,
        theyOweYou: round2(theyOweYou),
        youOweThem: round2(youOweThem),
        theyOweYouAdded: round2(theyOweYouAdded),
        youOweThemAdded: round2(youOweThemAdded),
        settledInPeriod: round2(settledInPeriod),
        spentOnThemInPeriod: round2(spentOnThemInPeriod),
        eventCount: rangeEvents.length,
      },
      // Loan positions are their own labelled pair, deliberately NOT folded
      // into theyOweYou / youOweThem (which stay MemberCharge-only so no
      // existing number silently changes) and never netted against each other.
      loanPositions: {
        theyOweYouPrincipal: round2(lentOutstanding),
        youOweThemPrincipal: round2(borrowedOutstanding),
        interestReceived: round2(interestReceived),
        interestPaid: round2(interestPaid),
      },
      monthly,
      // Newest-first for the statement table.
      events: rangeEvents
        .slice()
        .reverse()
        .map((e) => ({
          id: e.id,
          date: e.date,
          type: e.type,
          group: e.group,
          label: e.label,
          description: e.description,
          account: e.account,
          amount: e.amount,
          direction: e.direction,
          cashDelta: e.cashDelta,
          runningCash: e.runningCash,
          transactionId: e.transactionId,
          loanId: e.loanId,
          hint: e.hint,
        })),
    });
  } catch (e) {
    return err(e);
  }
}

function buildMonthly(
  rangeEvents: BuiltEvent[],
  openingNetCash: number,
  from: Date | null,
  to: Date | null,
): Array<{
  key: string;
  label: string;
  inflow: number;
  outflow: number;
  net: number;
  cumulativeNet: number;
}> {
  if (rangeEvents.length === 0 && !from) return [];
  const monthKey = (d: Date) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

  let start: Date;
  let end: Date;
  if (from && to) {
    start = from;
    end = to;
  } else {
    const times = rangeEvents.map((e) => e.ts);
    start = new Date(from ?? Math.min(...times));
    end = new Date(to ?? Math.max(...times));
  }

  const buckets = new Map<string, { inflow: number; outflow: number }>();
  // Seed every month in the window so the chart has no gaps (cap runaway
  // custom ranges at 120 buckets).
  let y = start.getUTCFullYear();
  let m = start.getUTCMonth();
  const endY = end.getUTCFullYear();
  const endM = end.getUTCMonth();
  const order: string[] = [];
  let guard = 0;
  while ((y < endY || (y === endY && m <= endM)) && guard < 120) {
    const key = `${y}-${String(m + 1).padStart(2, "0")}`;
    buckets.set(key, { inflow: 0, outflow: 0 });
    order.push(key);
    m++;
    if (m > 11) {
      m = 0;
      y++;
    }
    guard++;
  }

  for (const e of rangeEvents) {
    if (e.cashDelta === 0) continue;
    const key = monthKey(new Date(e.ts));
    const b = buckets.get(key);
    if (!b) continue;
    if (e.cashDelta > 0) b.inflow += e.cashDelta;
    else b.outflow += -e.cashDelta;
  }

  let acc = openingNetCash;
  return order.map((key) => {
    const b = buckets.get(key)!;
    const net = b.inflow - b.outflow;
    acc += net;
    const [yy, mm] = key.split("-").map(Number);
    const label = new Date(Date.UTC(yy, mm - 1, 1)).toLocaleDateString("en-IN", {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
    return {
      key,
      label,
      inflow: round2(b.inflow),
      outflow: round2(b.outflow),
      net: round2(net),
      cumulativeNet: round2(acc),
    };
  });
}

function formatCompact(v: number): string {
  if (v >= 100000) return `₹${(v / 100000).toFixed(1)}L`;
  if (v >= 1000) return `₹${(v / 1000).toFixed(1)}k`;
  return `₹${Math.round(v)}`;
}

function startOfDay(d: Date): Date {
  d.setUTCHours(0, 0, 0, 0);
  return d;
}
function endOfDay(d: Date): Date {
  d.setUTCHours(23, 59, 59, 999);
  return d;
}
