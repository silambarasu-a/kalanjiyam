/**
 * Repair card statements duplicated by a statement-date edit.
 *
 * Before close-month keying landed, `materializeStatementsFor` matched an
 * existing statement by its exact `periodStart`. That value is derived
 * from `Account.statementDate`, so changing the statement date (12 → 15)
 * shifted every cycle's boundaries, the lookup missed, and a SECOND bill
 * was minted for a month that already had one — overlapping the first and
 * double-counting the same spend.
 *
 * This script walks every credit-card account and:
 *
 *   1. collapses each billing cycle (identified by the calendar month it
 *      closes in) down to a single row, re-pointing payments, reminders
 *      and uploaded bill scans at the survivor before dropping the rest;
 *   2. re-runs materialisation so the surviving rows are re-anchored onto
 *      the account's CURRENT statement date. Paid bills are left exactly
 *      as they were — they're the record of money that actually moved —
 *      and anchor the following cycle so the transition month is billed
 *      once, with no gap.
 *
 * Run with:
 *   npx tsx prisma/scripts/dedupe-card-statements.ts --dry-run
 *   npx tsx prisma/scripts/dedupe-card-statements.ts
 *
 * Safe to re-run any number of times; subsequent runs are no-ops. The
 * daily card-statement cron performs the same repair on its own, so this
 * is only needed to fix things up immediately.
 */
import "dotenv/config";
import { prisma } from "../../src/lib/prisma";
import {
  findDuplicateStatementGroups,
  dedupeStatementsFor,
  materializeStatementsFor,
} from "../../src/lib/card-statement-service";

const dryRun = process.argv.includes("--dry-run");

function day(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function main() {
  const accounts = await prisma.account.findMany({
    where: { kind: "CARD" },
    select: {
      id: true,
      name: true,
      workspaceId: true,
      statementDate: true,
      linkedCard: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  console.log(
    `${dryRun ? "[dry run] " : ""}scanning ${accounts.length} card account(s)\n`,
  );

  let accountsWithDupes = 0;
  let rowsRemoved = 0;
  let statementsCreated = 0;

  for (const account of accounts) {
    const label = account.linkedCard?.name ?? account.name;
    const groups = await findDuplicateStatementGroups(account.id);

    if (groups.length > 0) {
      accountsWithDupes++;
      console.log(
        `${label} (account ${account.id}, statement date ${account.statementDate ?? "—"})`,
      );
      for (const { keeper, losers } of groups) {
        console.log(
          `  cycle closing ${day(keeper.periodEnd)}: keeping ${day(
            keeper.periodStart,
          )} → ${day(keeper.periodEnd)} ` +
            `(₹${Number(keeper.totalDue)}, ${keeper._count.payments} payment(s)` +
            `${keeper.paidAt ? ", paid" : ""}${keeper.manuallyEdited ? ", hand-edited" : ""})`,
        );
        for (const l of losers) {
          console.log(
            `    ${dryRun ? "would merge" : "merging"} ${day(l.periodStart)} → ${day(
              l.periodEnd,
            )} (₹${Number(l.totalDue)}, ${l._count.payments} payment(s)` +
              `${l.paidAt ? ", paid" : ""}${l.manuallyEdited ? ", hand-edited" : ""})`,
          );
        }
      }
    }

    if (dryRun) {
      rowsRemoved += groups.reduce((n, g) => n + g.losers.length, 0);
      continue;
    }

    rowsRemoved += await dedupeStatementsFor(account.id);
    // Re-anchor whatever survived onto the account's current cycle, and
    // fill any month the duplicates were masking.
    statementsCreated += await materializeStatementsFor(account.id);
  }

  console.log(
    `\n${dryRun ? "[dry run] " : ""}` +
      `${accountsWithDupes} account(s) had duplicated cycles · ` +
      `${rowsRemoved} duplicate row(s) ${dryRun ? "would be " : ""}merged` +
      (dryRun ? "" : ` · ${statementsCreated} missing statement(s) created`),
  );
  if (dryRun) {
    console.log("Nothing was written. Re-run without --dry-run to apply.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
