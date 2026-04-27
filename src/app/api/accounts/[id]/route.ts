import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  requireWorkspace,
  WorkspaceAccessError,
  assertWorkspaceMembers,
  assertWorkspaceContact,
} from "@/lib/workspace";
import { canAccessRecord, canModifyRecord } from "@/lib/permissions";
import { auth } from "@/lib/auth";
import { accountUpdateSchema } from "@/lib/validators-domain";
import { computeAccountBalance } from "@/lib/account-balance";

function error(err: unknown) {
  if (err instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireWorkspace("accounts", "read");
    const session = await auth();
    const { id } = await context.params;
    const account = await prisma.account.findUnique({
      where: { id },
      include: {
        ownerUser: { select: { id: true, name: true, email: true } },
        ownerContact: { select: { id: true, name: true } },
      },
    });
    if (!account || account.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!canAccessRecord(session, account)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const balance = await computeAccountBalance(account.id);
    return NextResponse.json({
      account: {
        ...account,
        openingBalance: Number(account.openingBalance),
        creditLimit: account.creditLimit == null ? null : Number(account.creditLimit),
      },
      balance,
    });
  } catch (err) {
    return error(err);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireWorkspace("accounts", "write");
    const session = await auth();
    const { id } = await context.params;
    const body = await request.json();
    const parsed = accountUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const existing = await prisma.account.findUnique({ where: { id } });
    if (!existing || existing.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!canModifyRecord(session, existing)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    await assertWorkspaceMembers(ctx.workspaceId, [
      parsed.data.ownerUserId,
      ...(parsed.data.sharedWithUserIds ?? []),
    ]);
    await assertWorkspaceContact(ctx.workspaceId, parsed.data.ownerContactId);
    const account = await prisma.account.update({
      where: { id },
      data: {
        name: parsed.data.name ?? existing.name,
        kind: parsed.data.kind ?? existing.kind,
        openingBalance: parsed.data.openingBalance ?? existing.openingBalance,
        creditLimit: parsed.data.creditLimit === undefined ? existing.creditLimit : parsed.data.creditLimit,
        statementDate:
          parsed.data.statementDate === undefined ? existing.statementDate : parsed.data.statementDate,
        gracePeriod:
          parsed.data.gracePeriod === undefined ? existing.gracePeriod : parsed.data.gracePeriod,
        ownerUserId:
          parsed.data.ownerUserId === undefined ? existing.ownerUserId : parsed.data.ownerUserId,
        ownerContactId:
          parsed.data.ownerContactId === undefined ? existing.ownerContactId : parsed.data.ownerContactId,
        sharedWithUserIds: parsed.data.sharedWithUserIds ?? existing.sharedWithUserIds,
        active: parsed.data.active ?? existing.active,
      },
    });
    return NextResponse.json({ id: account.id });
  } catch (err) {
    return error(err);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireWorkspace("accounts", "write");
    const session = await auth();
    const { id } = await context.params;
    const existing = await prisma.account.findUnique({ where: { id } });
    if (!existing || existing.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!canModifyRecord(session, existing)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const txCount = await prisma.transaction.count({ where: { accountId: id } });
    if (txCount > 0) {
      return NextResponse.json(
        { error: "Account has transactions — archive it instead of deleting." },
        { status: 400 }
      );
    }
    await prisma.account.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return error(err);
  }
}
