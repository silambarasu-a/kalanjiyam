import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { canAccessRecord, visibilityFilter } from "@/lib/permissions";
import { transferCreateSchema } from "@/lib/validators-domain";
import { TransactionType, MemberChargeStatus, MemberChargeType } from "@/generated/prisma/client";
import {
  findStatementForPayment,
  materializeStatementsFor,
  recomputeStatementPaidAt,
} from "@/lib/card-statement-service";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
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
      const t = await tx.transfer.create({
        data: {
          workspaceId: ctx.workspaceId,
          userId: ctx.userId,
          fromAccountId: fromAccount?.id ?? null,
          fromContactId: fromContact?.id ?? null,
          toAccountId: toAccount?.id ?? null,
          toContactId: toContact?.id ?? null,
          amount,
          date,
          notes,
          statementId: statementIdToTag,
        },
      });

      if (fromAccount && toAccount) {
        // Self-transfer: two transaction legs that link via transferId.
        await tx.transaction.createMany({
          data: [
            {
              workspaceId: ctx.workspaceId,
              type: TransactionType.TRANSFER,
              amount,
              description: notes ?? "Transfer out",
              date,
              accountId: fromAccount.id,
              userId: ctx.userId,
              createdByUserId: ctx.userId,
              transferId: t.id,
            },
            {
              workspaceId: ctx.workspaceId,
              type: TransactionType.TRANSFER,
              amount,
              description: notes ?? "Transfer in",
              date,
              accountId: toAccount.id,
              userId: ctx.userId,
              createdByUserId: ctx.userId,
              transferId: t.id,
            },
          ],
        });
      } else if (fromAccount && toContact) {
        // Outflow: my account → person. Single leg pinned to the member as
        // beneficiary so member-centric reports pick it up. When the user
        // marked the transfer as recoverable, create a MemberCharge first
        // and link the leg to it so the contact's Outstanding stat picks up
        // the amount and the existing settle flow can clear it.
        let memberChargeId: string | null = null;
        if (expectBack) {
          const mc = await tx.memberCharge.create({
            data: {
              workspaceId: ctx.workspaceId,
              beneficiaryContactId: toContact.id,
              amount,
              status: MemberChargeStatus.OUTSTANDING,
              notes: notes ?? null,
            },
          });
          memberChargeId = mc.id;
        }
        await tx.transaction.create({
          data: {
            workspaceId: ctx.workspaceId,
            type: TransactionType.TRANSFER,
            amount,
            description: notes ?? `Transfer to ${toContact.name}`,
            date,
            accountId: fromAccount.id,
            beneficiaryContactId: toContact.id,
            memberChargeType: expectBack
              ? MemberChargeType.RECOVERABLE
              : MemberChargeType.NONE,
            memberChargeId,
            userId: ctx.userId,
            createdByUserId: ctx.userId,
            transferId: t.id,
          },
        });
      } else if (fromContact && toAccount) {
        // Inflow: person → my account. Single leg on the destination
        // account; the payer member lives on the Transfer row, not the
        // leg, since beneficiaryContactId means "money received by", which
        // doesn't apply when the workspace is the recipient.
        await tx.transaction.create({
          data: {
            workspaceId: ctx.workspaceId,
            type: TransactionType.TRANSFER,
            amount,
            description: notes ?? `Transfer from ${fromContact.name}`,
            date,
            accountId: toAccount.id,
            userId: ctx.userId,
            createdByUserId: ctx.userId,
            transferId: t.id,
          },
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
