import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import {
  utilityProviderCreateSchema,
  utilityProviderListQuerySchema,
} from "@/lib/validators-domain";
import { canAccessRecord, visibilityFilter } from "@/lib/permissions";
import {
  type Prisma,
  UtilityKind,
  UtilityProviderStatus,
} from "@/generated/prisma/client";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[utility-providers]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const ctx = await requireWorkspace("bills", "read");
    const session = await auth();
    const { searchParams } = new URL(request.url);
    const parsed = utilityProviderListQuerySchema.safeParse({
      kind: searchParams.get("kind") ?? undefined,
      status: searchParams.get("status") ?? undefined,
      search: searchParams.get("search") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const where: Prisma.UtilityProviderWhereInput = {
      workspaceId: ctx.workspaceId,
      ...visibilityFilter(session, ctx.ownOnly),
    };
    if (parsed.data.kind) where.kind = parsed.data.kind as UtilityKind;
    if (parsed.data.status)
      where.status = parsed.data.status as UtilityProviderStatus;
    if (parsed.data.search) {
      where.OR = [
        { providerName: { contains: parsed.data.search, mode: "insensitive" } },
        { connectionNumber: { contains: parsed.data.search, mode: "insensitive" } },
      ];
    }

    const rows = await prisma.utilityProvider.findMany({
      where,
      orderBy: [{ status: "asc" }, { providerName: "asc" }],
      include: {
        account: { select: { id: true, name: true, kind: true } },
        card: { select: { id: true, name: true } },
      },
    });

    // Pull aggregate counts so the operators grid can show "unpaid" /
    // "next due" badges without a per-card N+1 round-trip.
    const providerIds = rows.map((r) => r.id);
    const billRows = providerIds.length
      ? await prisma.utilityBill.findMany({
          where: { providerId: { in: providerIds } },
          select: {
            providerId: true,
            dueDate: true,
            billAmount: true,
            paidAt: true,
          },
        })
      : [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    type BillSummary = {
      unpaidCount: number;
      overdueCount: number;
      nextDueDate: string | null;
      lastBillDate: string | null;
    };
    const summaryByProvider = new Map<string, BillSummary>();
    for (const b of billRows) {
      const s =
        summaryByProvider.get(b.providerId) ?? {
          unpaidCount: 0,
          overdueCount: 0,
          nextDueDate: null as string | null,
          lastBillDate: null as string | null,
        };
      if (!b.paidAt) {
        s.unpaidCount++;
        if (b.dueDate < today) s.overdueCount++;
        if (!s.nextDueDate || new Date(s.nextDueDate) > b.dueDate)
          s.nextDueDate = b.dueDate.toISOString();
      }
      if (!s.lastBillDate || new Date(s.lastBillDate) < b.dueDate)
        s.lastBillDate = b.dueDate.toISOString();
      summaryByProvider.set(b.providerId, s);
    }

    return NextResponse.json({
      providers: rows.map((p) => ({
        id: p.id,
        kind: p.kind,
        providerName: p.providerName,
        connectionNumber: p.connectionNumber,
        addressLine: p.addressLine,
        accountId: p.accountId,
        cardId: p.cardId,
        account: p.account,
        card: p.card,
        autoPay: p.autoPay,
        defaultDueDay: p.defaultDueDay,
        advanceBalance: Number(p.advanceBalance),
        status: p.status,
        notes: p.notes,
        summary:
          summaryByProvider.get(p.id) ?? {
            unpaidCount: 0,
            overdueCount: 0,
            nextDueDate: null,
            lastBillDate: null,
          },
      })),
    });
  } catch (e) {
    return err(e);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireWorkspace("bills", "write");
    const session = await auth();
    const body = await request.json();
    const parsed = utilityProviderCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const data = parsed.data;

    if (data.accountId) {
      const acc = await prisma.account.findUnique({
        where: { id: data.accountId },
        select: { workspaceId: true, ownerUserId: true, sharedWithUserIds: true },
      });
      if (!acc || acc.workspaceId !== ctx.workspaceId) {
        return NextResponse.json({ error: "Account not found" }, { status: 404 });
      }
      if (!canAccessRecord(session, acc)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }
    if (data.cardId) {
      const card = await prisma.card.findUnique({
        where: { id: data.cardId },
        select: { workspaceId: true, ownerUserId: true, sharedWithUserIds: true },
      });
      if (!card || card.workspaceId !== ctx.workspaceId) {
        return NextResponse.json({ error: "Card not found" }, { status: 404 });
      }
      if (!canAccessRecord(session, card)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    const created = await prisma.utilityProvider.create({
      data: {
        workspaceId: ctx.workspaceId,
        ownerUserId: ctx.userId,
        kind: data.kind as UtilityKind,
        providerName: data.providerName,
        connectionNumber: data.connectionNumber ?? null,
        addressLine: data.addressLine ?? null,
        accountId: data.accountId ?? null,
        cardId: data.cardId ?? null,
        autoPay: data.autoPay ?? false,
        defaultDueDay: data.defaultDueDay ?? null,
        status: (data.status ?? "ACTIVE") as UtilityProviderStatus,
        notes: data.notes ?? null,
      },
    });

    return NextResponse.json({ id: created.id });
  } catch (e) {
    return err(e);
  }
}
