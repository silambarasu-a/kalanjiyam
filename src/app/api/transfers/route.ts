import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { canAccessRecord, visibilityFilter } from "@/lib/permissions";
import { transferCreateSchema } from "@/lib/validators-domain";
import { TransactionType } from "@/generated/prisma/client";
import { createContactTransfer } from "@/lib/contact-transfer";
import {
  findStatementForPayment,
  materializeStatementsFor,
  recomputeStatementPaidAt,
} from "@/lib/card-statement-service";
import { formatMoney, isForeignWallet, round2 } from "@/lib/brokerage";
import {
  BrokerageError,
  assertWalletCanPay,
  resolveBankChargesCategoryId,
} from "@/lib/brokerage-wallet";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError || e instanceof BrokerageError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[transfers]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const ctx = await requireWorkspace("transfers", "read");
    const session = await auth();
    const url = new URL(request.url);
    const contactId = url.searchParams.get("contact");
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const limitParam = Number(url.searchParams.get("limit") ?? "50");
    const limit = Math.min(Math.max(limitParam, 1), 200);
    const offsetParam = Number(url.searchParams.get("offset") ?? "0");
    const offset = Math.max(0, Number.isFinite(offsetParam) ? offsetParam : 0);

    const where: Record<string, unknown> = { workspaceId: ctx.workspaceId };
    if (from || to) {
      const range: { gte?: Date; lte?: Date } = {};
      if (from) range.gte = new Date(from);
      if (to) {
        const end = new Date(to);
        end.setUTCHours(23, 59, 59, 999);
        range.lte = end;
      }
      where.date = range;
    }
    const andClauses: Record<string, unknown>[] = [];
    if (ctx.ownOnly) {
      const ownAccountIds = await prisma.account
        .findMany({
          where: {
            workspaceId: ctx.workspaceId,
            ...visibilityFilter(session, true),
          },
          select: { id: true },
        })
        .then((r) => r.map((a) => a.id));
      andClauses.push({
        OR: [
          { userId: ctx.userId },
          { fromAccountId: { in: ownAccountIds } },
          { toAccountId: { in: ownAccountIds } },
        ],
      });
    }
    if (contactId) {
      // Verify the contact belongs to this workspace before applying the
      // filter — prevents cross-workspace ID probing via the query string.
      const contact = await prisma.contact.findUnique({
        where: { id: contactId },
        select: { workspaceId: true },
      });
      if (!contact || contact.workspaceId !== ctx.workspaceId) {
        return NextResponse.json({ error: "Contact not found" }, { status: 404 });
      }
      andClauses.push({
        OR: [{ fromContactId: contactId }, { toContactId: contactId }],
      });
    }
    if (andClauses.length > 0) where.AND = andClauses;

    const [transfers, totalCount] = await Promise.all([
      prisma.transfer.findMany({
        where,
        orderBy: { date: "desc" },
        skip: offset,
        take: limit,
        include: {
          fromAccount: { select: { id: true, name: true, kind: true } },
          fromContact: { select: { id: true, name: true } },
          toAccount: { select: { id: true, name: true, kind: true } },
          toContact: { select: { id: true, name: true } },
        },
      }),
      prisma.transfer.count({ where }),
    ]);

    return NextResponse.json({
      transfers: transfers.map((t) => ({
        id: t.id,
        amount: Number(t.amount),
        date: t.date.toISOString(),
        notes: t.notes,
        // Each side is exactly one of account or member — clients render
        // whichever is populated.
        fromAccount: t.fromAccount,
        fromContact: t.fromContact,
        toAccount: t.toAccount,
        toContact: t.toContact,
        // Currency conversion, when one side is a foreign-currency
        // brokerage wallet. `amount` above is the INR side; `fx.amount`
        // is what the wallet saw.
        fx:
          t.fxAmount == null
            ? null
            : {
                currency: t.fxCurrency,
                amount: Number(t.fxAmount),
                rate: t.fxRate == null ? null : Number(t.fxRate),
                cgst: Number(t.cgst ?? 0),
                sgst: Number(t.sgst ?? 0),
              },
      })),
      pagination: { total: totalCount, offset, limit },
    });
  } catch (e) {
    return err(e);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireWorkspace("transfers", "write");
    const session = await auth();
    const body = await request.json();
    const parsed = transferCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const {
      fromAccountId,
      fromContactId,
      toAccountId,
      toContactId,
      amount,
      date: dateStr,
      notes,
      expectBack,
      oweBack,
      fx,
    } = parsed.data;

    // Resolve each side. The validator guarantees exactly one of (account,
    // member) is set on each side, and that at least one side is an account.
    let fromAccount: Awaited<ReturnType<typeof prisma.account.findUnique>> = null;
    let fromContact: Awaited<
      ReturnType<typeof prisma.contact.findUnique>
    > = null;
    let toAccount: Awaited<ReturnType<typeof prisma.account.findUnique>> = null;
    let toContact: Awaited<
      ReturnType<typeof prisma.contact.findUnique>
    > = null;

    if (fromAccountId) {
      fromAccount = await prisma.account.findUnique({ where: { id: fromAccountId } });
      if (!fromAccount || fromAccount.workspaceId !== ctx.workspaceId) {
        return NextResponse.json({ error: "Account not found" }, { status: 404 });
      }
      if (!canAccessRecord(session, fromAccount)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    } else if (fromContactId) {
      fromContact = await prisma.contact.findUnique({ where: { id: fromContactId } });
      if (!fromContact || fromContact.workspaceId !== ctx.workspaceId) {
        return NextResponse.json({ error: "Member not found" }, { status: 404 });
      }
    }

    if (toAccountId) {
      toAccount = await prisma.account.findUnique({ where: { id: toAccountId } });
      if (!toAccount || toAccount.workspaceId !== ctx.workspaceId) {
        return NextResponse.json({ error: "Account not found" }, { status: 404 });
      }
      if (!canAccessRecord(session, toAccount)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    } else if (toContactId) {
      toContact = await prisma.contact.findUnique({ where: { id: toContactId } });
      if (!toContact || toContact.workspaceId !== ctx.workspaceId) {
        return NextResponse.json({ error: "Member not found" }, { status: 404 });
      }
    }

    // ── Currency conversion ─────────────────────────────────────────────
    // A foreign-currency brokerage wallet on one side turns this into a
    // conversion: `amount` is the INR that moved on the rupee side and
    // `fx.amount` what the wallet gained (deposit) or gave up (withdrawal).
    // The rate is derived, never taken from the client, so the three
    // figures on the row always agree.
    const fromForeign = isForeignWallet(fromAccount);
    const toForeign = isForeignWallet(toAccount);
    let conversion: {
      wallet: NonNullable<typeof fromAccount>;
      rupeeAccount: NonNullable<typeof fromAccount>;
      fxAmount: number;
      fxRate: number;
      cgst: number;
      sgst: number;
    } | null = null;
    if (fromForeign || toForeign) {
      if (!fromAccount || !toAccount) {
        return NextResponse.json(
          {
            error:
              "A foreign-currency wallet can only be funded from, or withdrawn to, one of your own accounts",
          },
          { status: 400 },
        );
      }
      if (fromForeign && toForeign) {
        return NextResponse.json(
          {
            error:
              "Moving money directly between two foreign-currency wallets isn't supported — withdraw to a rupee account first",
          },
          { status: 400 },
        );
      }
      const wallet = fromForeign ? fromAccount : toAccount;
      const rupeeAccount = fromForeign ? toAccount : fromAccount;
      if (rupeeAccount.kind === "CARD") {
        return NextResponse.json(
          { error: "Pick a bank, cash or wallet account for the rupee side of a conversion" },
          { status: 400 },
        );
      }
      if (!fx) {
        return NextResponse.json(
          {
            error: `Enter the ${wallet.currency} amount — ${wallet.name}'s wallet is in ${wallet.currency}`,
          },
          { status: 400 },
        );
      }
      conversion = {
        wallet,
        rupeeAccount,
        fxAmount: round2(fx.amount),
        fxRate: amount / fx.amount,
        cgst: round2(fx.cgst ?? 0),
        sgst: round2(fx.sgst ?? 0),
      };
    } else if (fx) {
      return NextResponse.json(
        {
          error:
            "A currency conversion needs a foreign-currency brokerage wallet on one side",
        },
        { status: 400 },
      );
    }

    // A brokerage wallet can't pay out more than it holds — in its own
    // currency, which for a foreign wallet is `fx.amount`, not `amount`.
    if (fromAccount?.kind === "BROKERAGE") {
      await assertWalletCanPay(fromAccount, {
        amountInr: amount,
        fxAmount: conversion?.fxAmount ?? null,
      });
    }

    const conversionGst = conversion ? round2(conversion.cgst + conversion.sgst) : 0;
    const feeCategoryId =
      conversionGst > 0 ? await resolveBankChargesCategoryId(ctx.workspaceId) : null;
    // "₹88,500.00 → $1,000.00" for a deposit, the reverse for a withdrawal.
    const conversionLabel = conversion
      ? fromForeign
        ? `${formatMoney(conversion.fxAmount, conversion.wallet.currency)} → ${formatMoney(amount, "INR")}`
        : `${formatMoney(amount, "INR")} → ${formatMoney(conversion.fxAmount, conversion.wallet.currency)}`
      : null;

    const date = new Date(dateStr);
    // When the destination is a credit-card companion account, this
    // transfer is a bill payment. Make sure all closed statements exist
    // before we look for one to tag, then pick the best match. Tagging
    // ahead of `tx.transfer.create` keeps the row's statementId consistent
    // from the start.
    let statementIdToTag: string | null = null;
    if (toAccount && toAccount.kind === "CARD") {
      await materializeStatementsFor(toAccount.id, date);
      statementIdToTag = await findStatementForPayment(toAccount.id);
    }

    const transfer = await prisma.$transaction(async (tx) => {
      // One side is a contact → both of those shapes live in
      // createContactTransfer, shared with the bulk-settle leftover so the
      // two record an identical set of rows. The validator guarantees the
      // other side is an account.
      if (!fromAccount || !toAccount) {
        const contact = (fromContact ?? toContact)!;
        const account = (fromAccount ?? toAccount)!;
        const outgoing = !!fromAccount;
        const { transferId } = await createContactTransfer(tx, {
          workspaceId: ctx.workspaceId,
          userId: ctx.userId,
          contactId: contact.id,
          contactName: contact.name,
          accountId: account.id,
          amount,
          date,
          notes: notes ?? null,
          outgoing,
          obligation: outgoing ? !!expectBack : !!oweBack,
          statementId: statementIdToTag,
        });
        return { id: transferId };
      }

      // Self-transfer: two transaction legs that link via transferId.
      const t = await tx.transfer.create({
        data: {
          workspaceId: ctx.workspaceId,
          userId: ctx.userId,
          fromAccountId: fromAccount.id,
          toAccountId: toAccount.id,
          amount,
          date,
          notes,
          statementId: statementIdToTag,
          createsObligation: false,
          ...(conversion
            ? {
                fxCurrency: conversion.wallet.currency,
                fxAmount: conversion.fxAmount,
                fxRate: conversion.fxRate,
                cgst: conversion.cgst,
                sgst: conversion.sgst,
              }
            : {}),
        },
      });
      // The wallet-side leg carries the wallet-currency figure so the
      // wallet's statement can show what it actually gained or lost.
      const walletLeg = conversion
        ? { fxAmount: conversion.fxAmount, exchangeRate: conversion.fxRate }
        : null;
      await tx.transaction.createMany({
        data: [
          {
            workspaceId: ctx.workspaceId,
            type: TransactionType.TRANSFER,
            amount,
            description:
              notes ?? (conversionLabel ? `Converted ${conversionLabel}` : "Transfer out"),
            date,
            accountId: fromAccount.id,
            userId: ctx.userId,
            createdByUserId: ctx.userId,
            transferId: t.id,
            ...(walletLeg && fromForeign ? walletLeg : {}),
          },
          {
            workspaceId: ctx.workspaceId,
            type: TransactionType.TRANSFER,
            amount,
            description:
              notes ?? (conversionLabel ? `Converted ${conversionLabel}` : "Transfer in"),
            date,
            accountId: toAccount.id,
            userId: ctx.userId,
            createdByUserId: ctx.userId,
            transferId: t.id,
            ...(walletLeg && toForeign ? walletLeg : {}),
          },
        ],
      });
      // GST on the conversion: a real cost, so it's an EXPENSE on the rupee
      // account in its own right (cashflow / P&L see it) rather than being
      // buried in the transfer. `transferId` stays null on purpose — rows
      // with one are treated as legs and skipped by every balance sum. The
      // transfer points at it instead, and owns it: deleting the transfer
      // deletes this row.
      if (conversion && conversionGst > 0) {
        const fee = await tx.transaction.create({
          data: {
            workspaceId: ctx.workspaceId,
            type: TransactionType.EXPENSE,
            amount: conversionGst,
            description: `GST on currency conversion · ${conversionLabel} (CGST ${formatMoney(conversion.cgst, "INR")} + SGST ${formatMoney(conversion.sgst, "INR")})`,
            date,
            categoryId: feeCategoryId,
            accountId: conversion.rupeeAccount.id,
            userId: ctx.userId,
            createdByUserId: ctx.userId,
          },
        });
        await tx.transfer.update({
          where: { id: t.id },
          data: { feeTransactionId: fee.id },
        });
      }
      return t;
    });
    if (statementIdToTag) {
      await recomputeStatementPaidAt(statementIdToTag);
    }
    return NextResponse.json({ id: transfer.id });
  } catch (e) {
    return err(e);
  }
}
