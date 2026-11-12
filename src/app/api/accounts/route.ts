import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  requireWorkspace,
  WorkspaceAccessError,
  assertWorkspaceMembers,
  assertWorkspaceContact,
} from "@/lib/workspace";
import { visibilityFilter } from "@/lib/permissions";
import { auth } from "@/lib/auth";
import { accountCreateSchema } from "@/lib/validators-domain";
import { computeAccountBalance } from "@/lib/account-balance";
import { computeAccountAvailableLimit } from "@/lib/card-available-limit";
import { untaggedPaymentsToCard } from "@/lib/card-statement-service";
import { HOME_CURRENCY, isForeignCurrency } from "@/lib/brokerage";

function error(err: unknown) {
  if (err instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error("[accounts]", err);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function GET() {
  try {
    const ctx = await requireWorkspace("accounts", "read");
    const session = await auth();
    const accounts = await prisma.account.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        ...visibilityFilter(session, ctx.ownOnly),
      },
      orderBy: [{ active: "desc" }, { name: "asc" }],
      include: {
        ownerUser: { select: { id: true, name: true, email: true } },
        ownerContact: { select: { id: true, name: true } },
        linkedCard: { select: { id: true } },
        _count: { select: { holdings: true } },
      },
    });

    const [balances, availableLimits, upcomingBills] = await Promise.all([
      Promise.all(accounts.map((a) => computeAccountBalance(a.id))),
      Promise.all(
        accounts.map((a) =>
          a.kind === "CARD" ? computeAccountAvailableLimit(a.id) : Promise.resolve(null),
        ),
      ),
      // Upcoming bill resolution mirrors /api/cards: a manual override on
      // Account.nextBillAmount wins, otherwise fall back to the oldest
      // unpaid CardStatement's outstanding (totalDue − tagged payments).
      Promise.all(
        accounts.map(async (a) => {
          if (a.kind !== "CARD") return null;
          // 1. Prefer a still-owing manual override.
          if (a.nextBillAmount != null) {
            const manualAmount = Number(a.nextBillAmount);
            const cutoff = a.nextBillDue ?? new Date();
            const paidUntagged = await untaggedPaymentsToCard(a.id, cutoff);
            const remaining = Math.max(0, manualAmount - paidUntagged);
            if (remaining > 0) {
              return { amount: remaining, dueDate: a.nextBillDue ?? null };
            }
            // Manual override fully paid — fall through to the next
            // materialised statement.
          }
          const unpaid = await prisma.cardStatement.findFirst({
            where: { accountId: a.id, paidAt: null },
            orderBy: { dueDate: "asc" },
            select: {
              totalDue: true,
              dueDate: true,
              payments: { select: { amount: true } },
            },
          });
          if (!unpaid) return null;
          const paid = unpaid.payments.reduce((s, p) => s + Number(p.amount), 0);
          const outstanding = Math.max(0, Number(unpaid.totalDue) - paid);
          if (outstanding === 0) return null;
          return { amount: outstanding, dueDate: unpaid.dueDate };
        }),
      ),
    ]);

    return NextResponse.json({
      accounts: accounts.map((a, i) => ({
        id: a.id,
        kind: a.kind,
        name: a.name,
        openingBalance: Number(a.openingBalance),
        creditLimit: a.creditLimit == null ? null : Number(a.creditLimit),
        statementDate: a.statementDate,
        gracePeriod: a.gracePeriod,
        active: a.active,
        ownerUser: a.ownerUser,
        ownerContact: a.ownerContact,
        sharedWithUserIds: a.sharedWithUserIds,
        // INR for every account. Brokerage wallets also report
        // `nativeBalance` in their own `currency` (equal to `balance` for
        // an INR wallet) and, for a foreign one, the average INR cost of
        // each unit still sitting in it.
        balance: balances[i].balance,
        currency: a.currency,
        nativeBalance: balances[i].nativeBalance,
        avgRate: balances[i].avgRate,
        openingFxBalance:
          a.openingFxBalance == null ? null : Number(a.openingFxBalance),
        dematNumber: a.dematNumber,
        brokerClientId: a.brokerClientId,
        holdingsCount: a._count.holdings,
        availableLimit: availableLimits[i],
        upcomingBillAmount: upcomingBills[i]?.amount ?? null,
        nextBillDue: upcomingBills[i]?.dueDate?.toISOString() ?? null,
        linkedCardId: a.linkedCard?.id ?? null,
      })),
    });
  } catch (err) {
    return error(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireWorkspace("accounts", "write");
    const body = await request.json();
    const parsed = accountCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    await assertWorkspaceMembers(ctx.workspaceId, [
      parsed.data.ownerUserId,
      ...(parsed.data.sharedWithUserIds ?? []),
    ]);
    await assertWorkspaceContact(ctx.workspaceId, parsed.data.ownerContactId);
    // Brokerage-only fields are dropped for every other kind, so a stray
    // `currency: "USD"` can never turn a bank account into a foreign one.
    const isBrokerage = parsed.data.kind === "BROKERAGE";
    const currency = isBrokerage ? (parsed.data.currency ?? HOME_CURRENCY) : HOME_CURRENCY;
    const foreign = isForeignCurrency(currency);
    const openingFx = foreign ? (parsed.data.openingFxBalance ?? 0) : null;
    if (foreign && openingFx! > 0 && !(parsed.data.openingBalance > 0)) {
      return NextResponse.json(
        {
          error: `Enter what the opening ${currency} balance is worth in rupees — it sets the wallet's starting rate`,
        },
        { status: 400 },
      );
    }
    const account = await prisma.account.create({
      data: {
        workspaceId: ctx.workspaceId,
        kind: parsed.data.kind,
        name: parsed.data.name,
        // An empty foreign wallet has no rupee value either.
        openingBalance: foreign && !(openingFx! > 0) ? 0 : parsed.data.openingBalance,
        currency,
        openingFxBalance: openingFx,
        dematNumber: isBrokerage ? parsed.data.dematNumber || null : null,
        brokerClientId: isBrokerage ? parsed.data.brokerClientId || null : null,
        creditLimit: parsed.data.creditLimit ?? null,
        statementDate: parsed.data.statementDate ?? null,
        gracePeriod: parsed.data.gracePeriod ?? null,
        ownerUserId: parsed.data.ownerUserId ?? ctx.userId,
        ownerContactId: parsed.data.ownerContactId ?? null,
        sharedWithUserIds: parsed.data.sharedWithUserIds ?? [],
      },
    });
    return NextResponse.json({ id: account.id });
  } catch (err) {
    return error(err);
  }
}
