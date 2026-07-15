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
 *   - Hand loans (they lent)                 → LOAN
 * Recoverable splits and recoverable "paid for me" rows are represented by
 * their MemberCharge (ACCRUAL) instead, so nothing is double-counted.
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
                  select: { id: true, description: true, date: true },
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
          where: { workspaceId: ctx.workspaceId, lenderContactId: id },
          select: {
            id: true,
            kind: true,
            principal: true,
            outstanding: true,
            startedAt: true,
            active: true,
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
      });
    }

    // ── Charges (accrual) + their settlements (cash) ────────────────────
    for (const c of charges) {
      const amount = Number(c.amount);
      const owedToUser = c.direction === "OWED_TO_USER"; // they owe you
      const forgiven = c.status === "WRITTEN_OFF";
      const originTxn = c.originSplit?.transaction ?? null;
      const chargeDate = originTxn?.date ?? c.createdAt;
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
        description:
          originTxn?.description ??
          c.notes ??
          (owedToUser ? "Amount owed to you" : "Amount you owe"),
        account: null,
        amount,
        direction: "NEUTRAL",
        cashDelta: 0,
        runningCash: 0,
        transactionId: originTxn?.id ?? null,
        loanId: null,
      });
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
              ? `${contact.name} paid you`
              : `You paid ${contact.name}`),
          account: null,
          amount: samt,
          direction: settleIn ? "IN" : "OUT",
          cashDelta: settleIn ? samt : -samt,
          runningCash: 0,
          transactionId: s.transactionId ?? null,
          loanId: null,
        });
      }
    }

    // ── Spent on them (info) ────────────────────────────────────────────
    for (const e of spentSplits) {
      const txn = e.transaction;
      events.push({
        id: `split:${e.id}`,
        ts: txn.date.getTime(),
        date: txn.date.toISOString(),
        type: "SPENT_ON_THEM",
        group: "INFO",
        label:
          txn.memberChargeType === "GIFT"
            ? "Spent on them (gift)"
            : "Spent on them",
        description: txn.description,
        account: (txn.account ?? txn.card)?.name ?? null,
        amount: Number(e.amount),
        direction: "NEUTRAL",
        cashDelta: 0,
        runningCash: 0,
        transactionId: txn.id,
        loanId: null,
      });
    }

    // ── They paid for me — gift / none (info) ───────────────────────────
    for (const p of paidForMe) {
      events.push({
        id: `paidforme:${p.id}`,
        ts: p.date.getTime(),
        date: p.date.toISOString(),
        type: "THEY_PAID",
        group: "INFO",
        label:
          p.memberChargeType === "GIFT" ? "They paid (gift)" : "They paid",
        description: p.description,
        account: null,
        amount: Number(p.amount),
        direction: "NEUTRAL",
        cashDelta: 0,
        runningCash: 0,
        transactionId: p.id,
        loanId: null,
      });
    }

    // ── Hand loans (info) ───────────────────────────────────────────────
    for (const l of loans) {
      const outstanding = Number(l.outstanding);
      events.push({
        id: `loan:${l.id}`,
        ts: l.startedAt.getTime(),
        date: l.startedAt.toISOString(),
        type: "LOAN",
        group: "LOAN",
        label: `Hand loan · ${l.kind}`,
        description: l.active
          ? `Borrowed from them — ${formatCompact(outstanding)} outstanding`
          : "Borrowed from them — cleared",
        account: null,
        amount: Number(l.principal),
        direction: "NEUTRAL",
        cashDelta: 0,
        runningCash: 0,
        transactionId: null,
        loanId: l.id,
      });
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
