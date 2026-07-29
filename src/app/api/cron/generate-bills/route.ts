import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  advanceBillCycle,
  computeDueDate,
  derivedBillPeriod,
} from "@/lib/bill-schedule";
import {
  BILL_MATCH_TOLERANCE_DAYS,
  ensureExpectedBillReminder,
} from "@/lib/utility-cycle";
import { ReminderKind } from "@/generated/prisma/client";

/**
 * Daily recurring-bill generator. For every ACTIVE provider with
 * `recurring=true` whose `nextBillDate` has arrived, creates the next
 * UtilityBill (and its due reminder), then advances the cursor by one
 * billing cycle. This is what makes a bill "auto-appear" each month so
 * the user never hand-enters it.
 *
 *   FIXED    provider → bill created at `defaultAmount`, ready to autopay.
 *   VARIABLE provider → bill created as an `estimated` placeholder that
 *                       waits for the user to enter the real amount.
 *   cycleVaries        → NO bill is created. The cadence is only an
 *                        expectation (electricity), so inventing a
 *                        statement on a guessed date would be a lie —
 *                        instead a UTILITY_BILL_EXPECTED reminder asks
 *                        the user to check and enter the real one, which
 *                        then re-anchors the cursor (see utility-cycle).
 *
 * Idempotent: the `nextBillDate` advance is the primary guard, backed by
 * a tolerance-window existence check (a real bill entered a few days off
 * the expected statement day still suppresses the placeholder). Runs
 * before the notifications (03:00) and autopay (04:00) sweeps so a
 * freshly-generated bill is picked up same day.
 *
 * Curl from dev:
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
 *     http://localhost:3003/api/cron/generate-bills
 */
function authorize(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const got = request.headers.get("authorization") ?? "";
  return got === `Bearer ${expected}`;
}

// Hard cap on how many periods a single provider can catch up in one run
// so a mis-set (far-past) cursor can't spawn hundreds of bills at once.
const CATCHUP_CAP = 12;

/**
 * Any bill for this provider whose statement date falls within the match
 * tolerance of `around`. The window is narrower than half the shortest
 * cycle (monthly), so it can only ever match the period being considered.
 */
async function findBillNear(
  providerId: string,
  around: Date,
): Promise<{ id: string } | null> {
  const lo = new Date(around);
  lo.setUTCDate(lo.getUTCDate() - BILL_MATCH_TOLERANCE_DAYS);
  const hi = new Date(around);
  hi.setUTCDate(hi.getUTCDate() + BILL_MATCH_TOLERANCE_DAYS);
  return prisma.utilityBill.findFirst({
    where: { providerId, billDate: { gte: lo, lte: hi } },
    select: { id: true },
  });
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

async function run() {
  const today = new Date();
  today.setUTCHours(23, 59, 59, 999);

  const providers = await prisma.utilityProvider.findMany({
    where: {
      recurring: true,
      status: "ACTIVE",
      nextBillDate: { lte: today },
      // Prepaid connections run on a validity clock, not a bill cycle —
      // they force `recurring` off, but exclude them explicitly for safety.
      prepaid: false,
    },
    take: 500,
  });

  let created = 0;
  let promptsRaised = 0;
  let cappedProviders = 0;
  const failures: { id: string; reason: string }[] = [];

  for (const provider of providers) {
    try {
      let cursor = provider.nextBillDate;
      if (!cursor) continue;
      let generatedForProvider = 0;

      const isFixed =
        provider.amountMode === "FIXED" && provider.defaultAmount != null;
      const defaultAmount =
        provider.defaultAmount != null ? Number(provider.defaultAmount) : 0;

      // ── Variable-cadence providers ────────────────────────────────
      // Prompt instead of generate. The expected date is the FIRST due
      // cursor (not the caught-up one) so the reminder reads as the bill
      // the user is actually waiting on. Skipped entirely when a real
      // bill already landed near that date — the user beat the cron to it.
      if (provider.cycleVaries) {
        const expectedOn = new Date(cursor);
        const alreadyBilled = await findBillNear(provider.id, expectedOn);
        if (!alreadyBilled) {
          const raised = await prisma.$transaction((tx) =>
            ensureExpectedBillReminder(tx, {
              workspaceId: provider.workspaceId,
              providerId: provider.id,
              expectedOn,
            }),
          );
          if (raised) promptsRaised++;
        }
        // Move the cursor past today so this fires once per expected
        // cycle rather than every night.
        let hops = 0;
        while (cursor <= today && hops < CATCHUP_CAP) {
          cursor = advanceBillCycle(cursor, provider.billingCycle);
          hops++;
        }
        if (cursor <= today) cappedProviders++;
        await prisma.utilityProvider.update({
          where: { id: provider.id },
          data: { nextBillDate: cursor },
        });
        continue;
      }

      while (cursor <= today && generatedForProvider < CATCHUP_CAP) {
        const billDate = new Date(cursor);
        const dueDate = computeDueDate(billDate, {
          defaultDueDay: provider.defaultDueDay,
          gracePeriodDays: provider.gracePeriodDays,
        });

        // Secondary idempotency guard: skip when a bill already sits near
        // this date. Matching on a window rather than the exact day means
        // a real bill entered a little off the expected statement day
        // suppresses the placeholder instead of doubling up beside it.
        const existing = await findBillNear(provider.id, billDate);
        if (!existing) {
          // FIXED → real amount, payable now. VARIABLE → the same figure
          // seeds an `estimated` placeholder the user confirms later
          // (0 when no default is set, i.e. a pure "enter amount" stub).
          const billAmount = defaultAmount;
          const reminderAmount =
            isFixed || provider.defaultAmount != null ? billAmount : null;
          // Stamp the cycle-derived service window. For a fixed-cadence
          // provider this IS the real window; the user can still correct
          // it when confirming the amount.
          const period = derivedBillPeriod(billDate, provider.billingCycle);
          await prisma.$transaction(async (tx) => {
            const bill = await tx.utilityBill.create({
              data: {
                workspaceId: provider.workspaceId,
                providerId: provider.id,
                billDate,
                dueDate,
                periodFrom: period.from,
                periodTo: period.to,
                billAmount,
                autoGenerated: true,
                estimated: !isFixed,
              },
            });
            await tx.investmentReminder.create({
              data: {
                workspaceId: provider.workspaceId,
                utilityBillId: bill.id,
                kind: ReminderKind.UTILITY_BILL_DUE,
                dueDate,
                amount: reminderAmount,
              },
            });
          });
          created++;
        }

        cursor = advanceBillCycle(cursor, provider.billingCycle);
        generatedForProvider++;
      }

      if (generatedForProvider >= CATCHUP_CAP && cursor <= today) {
        cappedProviders++;
      }

      // Persist the advanced cursor (now in the future, or the capped
      // point — the next run resumes catch-up from here).
      await prisma.utilityProvider.update({
        where: { id: provider.id },
        data: { nextBillDate: cursor },
      });
    } catch (e) {
      failures.push({
        id: provider.id,
        reason: e instanceof Error ? e.message : "unknown",
      });
    }
  }

  return NextResponse.json({
    ok: true,
    providersScanned: providers.length,
    billsCreated: created,
    // Variable-cadence providers asked to check for a bill instead.
    promptsRaised,
    cappedProviders,
    failures,
  });
}
