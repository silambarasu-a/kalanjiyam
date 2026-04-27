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
      },
    });

    const [balances, availableLimits] = await Promise.all([
      Promise.all(accounts.map((a) => computeAccountBalance(a.id))),
      Promise.all(
        accounts.map((a) =>
          a.kind === "CARD" ? computeAccountAvailableLimit(a.id) : Promise.resolve(null),
        ),
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
        balance: balances[i].balance,
        availableLimit: availableLimits[i],
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
    const account = await prisma.account.create({
      data: {
        workspaceId: ctx.workspaceId,
        kind: parsed.data.kind,
        name: parsed.data.name,
        openingBalance: parsed.data.openingBalance,
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
