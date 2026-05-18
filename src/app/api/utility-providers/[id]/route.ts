import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { utilityProviderUpdateSchema } from "@/lib/validators-domain";
import { canModifyRecord } from "@/lib/permissions";
import {
  UtilityKind,
  UtilityProviderStatus,
} from "@/generated/prisma/client";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[utility-providers/[id]]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireWorkspace("bills", "read");
    const { id } = await context.params;
    const p = await prisma.utilityProvider.findUnique({
      where: { id },
      include: {
        account: { select: { id: true, name: true, kind: true } },
        card: { select: { id: true, name: true } },
        owner: { select: { id: true, name: true } },
      },
    });
    if (!p || p.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({
      provider: {
        id: p.id,
        kind: p.kind,
        providerName: p.providerName,
        connectionNumber: p.connectionNumber,
        addressLine: p.addressLine,
        accountId: p.accountId,
        cardId: p.cardId,
        account: p.account,
        card: p.card,
        owner: p.owner,
        autoPay: p.autoPay,
        defaultDueDay: p.defaultDueDay,
        advanceBalance: Number(p.advanceBalance),
        status: p.status,
        notes: p.notes,
      },
    });
  } catch (e) {
    return err(e);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireWorkspace("bills", "write");
    const session = await auth();
    const { id } = await context.params;
    const existing = await prisma.utilityProvider.findUnique({ where: { id } });
    if (!existing || existing.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!canModifyRecord(session, existing)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = await request.json();
    const parsed = utilityProviderUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const d = parsed.data;
    await prisma.utilityProvider.update({
      where: { id },
      data: {
        kind: (d.kind as UtilityKind | undefined) ?? undefined,
        providerName: d.providerName ?? undefined,
        connectionNumber: d.connectionNumber === undefined ? undefined : d.connectionNumber,
        addressLine: d.addressLine === undefined ? undefined : d.addressLine,
        accountId: d.accountId === undefined ? undefined : d.accountId,
        cardId: d.cardId === undefined ? undefined : d.cardId,
        autoPay: d.autoPay ?? undefined,
        defaultDueDay:
          d.defaultDueDay === undefined ? undefined : d.defaultDueDay,
        status: (d.status as UtilityProviderStatus | undefined) ?? undefined,
        notes: d.notes === undefined ? undefined : d.notes,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}

/**
 * Soft-deactivate by default. Pass `?hard=1` to attempt a hard delete —
 * only allowed when no bills and no advance transactions exist AND
 * advanceBalance == 0. Otherwise falls back to soft.
 */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireWorkspace("bills", "write");
    const session = await auth();
    const { id } = await context.params;
    const p = await prisma.utilityProvider.findUnique({ where: { id } });
    if (!p || p.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!canModifyRecord(session, p)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const url = new URL(request.url);
    const hard = url.searchParams.get("hard") === "1";
    if (hard) {
      const [billCount, advanceCount] = await Promise.all([
        prisma.utilityBill.count({ where: { providerId: id } }),
        prisma.transaction.count({
          where: { utilityProviderId: id, kind: "UTILITY_ADVANCE" },
        }),
      ]);
      if (
        billCount === 0 &&
        advanceCount === 0 &&
        Number(p.advanceBalance) === 0
      ) {
        await prisma.utilityProvider.delete({ where: { id } });
        return NextResponse.json({ ok: true, mode: "hard" });
      }
      // Fall through to soft on conflict.
    }

    await prisma.utilityProvider.update({
      where: { id },
      data: { status: UtilityProviderStatus.INACTIVE },
    });
    return NextResponse.json({ ok: true, mode: "soft" });
  } catch (e) {
    return err(e);
  }
}
