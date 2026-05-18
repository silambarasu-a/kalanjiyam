import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import {
  subscriptionCreateSchema,
  subscriptionListQuerySchema,
} from "@/lib/validators-domain";
import {
  ReminderKind,
  ReminderStatus,
  SubscriptionCycle,
  SubscriptionStatus,
  type Prisma,
} from "@/generated/prisma/client";
import { canAccessRecord, visibilityFilter } from "@/lib/permissions";
import { advanceCycle } from "@/lib/cascades";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[subscriptions]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

function parseDate(value: string): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new WorkspaceAccessError(400, "Invalid date");
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export async function GET(request: Request) {
  try {
    const ctx = await requireWorkspace("subscriptions", "read");
    const session = await auth();
    const { searchParams } = new URL(request.url);
    const parsed = subscriptionListQuerySchema.safeParse({
      status: searchParams.get("status") ?? undefined,
      cycle: searchParams.get("cycle") ?? undefined,
      search: searchParams.get("search") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const where: Prisma.SubscriptionWhereInput = {
      workspaceId: ctx.workspaceId,
      ...visibilityFilter(session, ctx.ownOnly),
    };
    if (parsed.data.status) where.status = parsed.data.status as SubscriptionStatus;
    if (parsed.data.cycle) where.cycle = parsed.data.cycle as SubscriptionCycle;
    if (parsed.data.search) {
      where.name = { contains: parsed.data.search, mode: "insensitive" };
    }

    const rows = await prisma.subscription.findMany({
      where,
      orderBy: [{ status: "asc" }, { nextBillingDate: "asc" }],
      include: {
        account: { select: { id: true, name: true, kind: true } },
        card: { select: { id: true, name: true, network: true } },
        category: { select: { id: true, name: true } },
        owner: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json({
      subscriptions: rows.map((s) => ({
        id: s.id,
        name: s.name,
        amount: Number(s.amount),
        cycle: s.cycle,
        status: s.status,
        nextBillingDate: s.nextBillingDate.toISOString(),
        startedOn: s.startedOn.toISOString(),
        endsOn: s.endsOn?.toISOString() ?? null,
        autoPay: s.autoPay,
        logoUrl: s.logoUrl,
        notes: s.notes,
        account: s.account,
        card: s.card,
        category: s.category,
        owner: s.owner,
      })),
    });
  } catch (e) {
    return err(e);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireWorkspace("subscriptions", "write");
    const session = await auth();
    const body = await request.json();
    const parsed = subscriptionCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const data = parsed.data;

    // Verify the chosen source is in this workspace and accessible.
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

    const nextBilling = parseDate(data.nextBillingDate);
    const startedOn = parseDate(data.startedOn);
    const endsOn = data.endsOn ? parseDate(data.endsOn) : null;

    const created = await prisma.$transaction(async (tx) => {
      const sub = await tx.subscription.create({
        data: {
          workspaceId: ctx.workspaceId,
          ownerUserId: ctx.userId,
          name: data.name,
          amount: data.amount,
          cycle: data.cycle as SubscriptionCycle,
          nextBillingDate: nextBilling,
          startedOn,
          endsOn,
          accountId: data.accountId ?? null,
          cardId: data.cardId ?? null,
          autoPay: data.autoPay ?? false,
          categoryId: data.categoryId ?? null,
          logoUrl: data.logoUrl ?? null,
          notes: data.notes ?? null,
          status: (data.status ?? "ACTIVE") as SubscriptionStatus,
        },
      });

      // Seed one UPCOMING schedule row + reminder for the next billing date.
      if (sub.status === SubscriptionStatus.ACTIVE) {
        const schedule = await tx.subscriptionSchedule.create({
          data: {
            subscriptionId: sub.id,
            dueDate: nextBilling,
            amount: data.amount,
            status: ReminderStatus.UPCOMING,
          },
        });
        await tx.investmentReminder.create({
          data: {
            workspaceId: ctx.workspaceId,
            subscriptionId: sub.id,
            subscriptionScheduleId: schedule.id,
            kind: ReminderKind.SUBSCRIPTION_RENEWAL,
            dueDate: nextBilling,
            amount: data.amount,
          },
        });
      }

      return sub;
    });

    // advanceCycle is exported but not used here — referenced for parity
    // with the pay route which advances on every confirm.
    void advanceCycle;

    return NextResponse.json({ id: created.id });
  } catch (e) {
    return err(e);
  }
}
