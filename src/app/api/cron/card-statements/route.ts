import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { materializeStatementsFor } from "@/lib/card-statement-service";

/**
 * Daily card-statement materialisation sweep — call this from Vercel
 * Cron (or curl in dev) with `Authorization: Bearer <CRON_SECRET>`.
 * Walks every credit-card account in every workspace and (idempotently)
 * creates `CardStatement` rows for any closed billing cycle that doesn't
 * already have one. The card detail page still does the same lazy
 * materialisation as a safety net.
 *
 * Curl from the local dev server:
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
 *     http://localhost:3003/api/cron/card-statements
 */
function authorize(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return false;
  }
  const got = request.headers.get("authorization") ?? "";
  return got === `Bearer ${expected}`;
}

export async function POST(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return run();
}

export async function GET(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return run();
}

type WorkspaceTally = {
  accounts: number;
  statementsCreated: number;
  errors: number;
};

async function run() {
  const startedAt = new Date();

  const cardAccounts = await prisma.account.findMany({
    where: { kind: "CARD" },
    select: { id: true, workspaceId: true },
  });

  let statementsCreated = 0;
  const errors: { accountId: string; workspaceId: string; message: string }[] = [];
  const byWorkspace: Record<string, WorkspaceTally> = {};

  for (const a of cardAccounts) {
    const tally = (byWorkspace[a.workspaceId] ??= {
      accounts: 0,
      statementsCreated: 0,
      errors: 0,
    });
    tally.accounts++;
    try {
      const created = await materializeStatementsFor(a.id);
      statementsCreated += created;
      tally.statementsCreated += created;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ accountId: a.id, workspaceId: a.workspaceId, message });
      tally.errors++;
      console.error(
        `[cron/card-statements] failed for account=${a.id} workspace=${a.workspaceId}: ${message}`,
      );
    }
  }

  return NextResponse.json({
    ok: errors.length === 0,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    accountsScanned: cardAccounts.length,
    statementsCreated,
    errorCount: errors.length,
    byWorkspace,
    errors: errors.slice(0, 50),
  });
}
