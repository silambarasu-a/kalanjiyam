import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createNotification } from "@/lib/notifications";
import {
  NotificationKind,
  ReminderKind,
  ReminderStatus,
} from "@/generated/prisma/client";

/**
 * Daily notifications sweep — call this from Vercel Cron (or a curl in
 * dev) with `Authorization: Bearer <CRON_SECRET>`. Scans every workspace
 * for InvestmentReminder rows due in 7 / 3 / 0 days and persists one
 * Notification per (reminder, kind) pair. Idempotent — re-running the
 * same day is a no-op.
 *
 * Curl from the local dev server:
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
 *     http://localhost:3003/api/cron/notifications
 */
const TRIGGER_DAYS = [5, 3, 1, 0] as const;

const REMINDER_TO_NOTIFICATION: Record<ReminderKind, NotificationKind> = {
  INSURANCE_PREMIUM: NotificationKind.PREMIUM_DUE_SOON,
  LOAN_EMI: NotificationKind.LOAN_EMI_DUE,
  CARD_STATEMENT: NotificationKind.CARD_STATEMENT_DUE,
  SIP_BUY: NotificationKind.GENERIC,
  FD_INTEREST: NotificationKind.GENERIC,
  LEASE_PAYMENT: NotificationKind.GENERIC,
  VEHICLE_DOC_RENEWAL: NotificationKind.GENERIC,
  SUBSCRIPTION_RENEWAL: NotificationKind.SUBSCRIPTION_RENEWAL_DUE,
  UTILITY_BILL_DUE: NotificationKind.UTILITY_BILL_DUE_SOON,
  UTILITY_BILL_EXPECTED: NotificationKind.UTILITY_BILL_EXPECTED,
  UTILITY_RECHARGE_DUE: NotificationKind.UTILITY_RECHARGE_DUE_SOON,
  VACCINATION_DUE: NotificationKind.VACCINATION_DUE,
  LIVESTOCK_CYCLE_ENDING: NotificationKind.LIVESTOCK_CYCLE_ENDING,
};

const VEHICLE_DOC_KIND_LABEL: Record<string, string> = {
  RC: "RC book",
  FC: "Fitness Certificate",
  PUC: "Pollution Certificate",
  ROAD_TAX: "Road tax",
  INSURANCE_COPY: "Insurance copy",
  OTHER: "Vehicle document",
};

function authorize(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    // Fail closed in production-like environments. In dev the user can
    // export CRON_SECRET=anything and hit the endpoint.
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

// Allow GET too — easier for some cron providers that don't POST.
export async function GET(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return run();
}

async function run() {
  const startedAt = new Date();
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const windowEnd = new Date(today);
  windowEnd.setUTCDate(windowEnd.getUTCDate() + Math.max(...TRIGGER_DAYS) + 1);

  const reminders = await prisma.investmentReminder.findMany({
    where: {
      status: ReminderStatus.UPCOMING,
      dueDate: { gte: today, lt: windowEnd },
    },
    include: {
      investment: { select: { name: true, id: true, kind: true, policyType: true } },
      loan: { select: { id: true, lender: true } },
      vehicleDocument: {
        select: {
          id: true,
          kind: true,
          label: true,
          vehicleId: true,
          vehicle: { select: { id: true, name: true, registrationNo: true } },
        },
      },
      subscription: { select: { id: true, name: true } },
      utilityBill: {
        select: {
          id: true,
          dueDate: true,
          billAmount: true,
          estimated: true,
          provider: { select: { id: true, providerName: true, kind: true } },
        },
      },
      utilityProvider: {
        select: { id: true, providerName: true, kind: true },
      },
      vaccinationLog: {
        select: {
          id: true,
          vaccine: true,
          batchId: true,
          batch: {
            select: {
              id: true,
              name: true,
              livestockId: true,
              livestock: { select: { name: true } },
            },
          },
        },
      },
      livestockBatch: {
        select: {
          id: true,
          name: true,
          livestockId: true,
          livestock: { select: { name: true } },
        },
      },
    },
  });

  let created = 0;
  let skipped = 0;
  for (const r of reminders) {
    const daysOut = Math.round(
      (r.dueDate.getTime() - today.getTime()) / 86_400_000,
    );
    if (!(TRIGGER_DAYS as readonly number[]).includes(daysOut)) {
      skipped++;
      continue;
    }
    const baseKind = REMINDER_TO_NOTIFICATION[r.kind];
    const kind: NotificationKind =
      r.kind === ReminderKind.INSURANCE_PREMIUM
        ? daysOut <= 0
          ? NotificationKind.PREMIUM_OVERDUE
          : NotificationKind.PREMIUM_DUE_SOON
        : r.kind === ReminderKind.UTILITY_BILL_DUE
          ? daysOut < 0
            ? NotificationKind.UTILITY_BILL_OVERDUE
            : NotificationKind.UTILITY_BILL_DUE_SOON
          : baseKind;

    let label: string;
    if (r.kind === ReminderKind.VEHICLE_DOC_RENEWAL && r.vehicleDocument) {
      const docLabel =
        r.vehicleDocument.label ??
        VEHICLE_DOC_KIND_LABEL[r.vehicleDocument.kind] ??
        "Vehicle document";
      const vehicleLabel =
        r.vehicleDocument.vehicle?.name ??
        r.vehicleDocument.vehicle?.registrationNo ??
        "vehicle";
      label = `${docLabel} (${vehicleLabel})`;
    } else if (r.kind === ReminderKind.SUBSCRIPTION_RENEWAL && r.subscription) {
      label = r.subscription.name;
    } else if (r.kind === ReminderKind.UTILITY_BILL_DUE && r.utilityBill) {
      label = `${r.utilityBill.provider.providerName} bill`;
    } else if (r.kind === ReminderKind.UTILITY_RECHARGE_DUE && r.utilityProvider) {
      label = `${r.utilityProvider.providerName} recharge`;
    } else if (r.kind === ReminderKind.UTILITY_BILL_EXPECTED && r.utilityProvider) {
      label = `${r.utilityProvider.providerName} bill`;
    } else if (r.kind === ReminderKind.VACCINATION_DUE && r.vaccinationLog) {
      const batch = r.vaccinationLog.batch;
      label = `${r.vaccinationLog.vaccine}${batch ? ` (${batch.livestock.name} · ${batch.name})` : ""}`;
    } else if (r.kind === ReminderKind.LIVESTOCK_CYCLE_ENDING && r.livestockBatch) {
      label = `${r.livestockBatch.livestock.name} · ${r.livestockBatch.name} cycle`;
    } else {
      label =
        r.investment?.name ??
        r.loan?.lender ??
        r.kind.replace(/_/g, " ").toLowerCase();
    }

    const isExpiry =
      r.kind === ReminderKind.VEHICLE_DOC_RENEWAL ||
      r.kind === ReminderKind.UTILITY_RECHARGE_DUE;
    // Auto-generated VARIABLE bills land with a placeholder amount — the
    // reminder's job is to prompt the user to enter the real figure.
    const isEstimatedBill =
      r.kind === ReminderKind.UTILITY_BILL_DUE && !!r.utilityBill?.estimated;
    // Variable-cadence provider: no bill exists yet and none will be
    // invented. The prompt is "go look", so it must not read like a due
    // date — an overdue one means the bill is late, not the payment.
    const isExpectedBill = r.kind === ReminderKind.UTILITY_BILL_EXPECTED;
    const title = isExpectedBill
      ? daysOut < 0
        ? `${label} still not entered`
        : daysOut === 0
          ? `${label} expected today`
          : `${label} expected in ${daysOut} day${daysOut === 1 ? "" : "s"}`
      : isEstimatedBill
      ? daysOut < 0
        ? `Enter amount for ${label} (overdue)`
        : `Enter amount for ${label}`
      : daysOut === 0
        ? isExpiry
          ? `${label} expires today`
          : `${label} is due today`
        : daysOut < 0
          ? isExpiry
            ? `${label} has expired`
            : `${label} is overdue`
          : isExpiry
            ? `${label} expires in ${daysOut} day${daysOut === 1 ? "" : "s"}`
            : `${label} due in ${daysOut} day${daysOut === 1 ? "" : "s"}`;
    const livestockBatchLink =
      r.vaccinationLog?.batch
        ? `/livestock/${r.vaccinationLog.batch.livestockId}/batches/${r.vaccinationLog.batch.id}`
        : r.livestockBatch
          ? `/livestock/${r.livestockBatch.livestockId}/batches/${r.livestockBatch.id}`
          : null;
    const link = r.vehicleDocument?.vehicleId
      ? `/vehicles/${r.vehicleDocument.vehicleId}`
      : r.subscription?.id
        ? `/subscriptions/${r.subscription.id}`
        : r.utilityBill?.provider?.id
          ? `/bills/providers/${r.utilityBill.provider.id}`
          : r.utilityProvider?.id
            ? `/bills/providers/${r.utilityProvider.id}`
            : livestockBatchLink
            ? livestockBatchLink
            : r.investment?.id
              ? r.investment.kind === "INSURANCE"
                ? `/insurance/${r.investment.id}`
                : `/investments/${r.investment.id}`
              : r.loan?.id
                ? `/loans/${r.loan.id}`
                : "/notifications";

    const body = isExpectedBill
      ? "This connection doesn't bill on a fixed cycle. Check the meter or portal and add the bill when it arrives."
      : isEstimatedBill
      ? "Auto-generated bill — set the actual amount so it can be paid."
      : isExpiry
        ? `Expires on ${r.dueDate.toISOString().slice(0, 10)}`
        : r.amount != null
          ? `Amount: ₹${Number(r.amount).toLocaleString("en-IN")}`
          : null;
    const result = await createNotification({
      workspaceId: r.workspaceId,
      kind,
      title,
      body,
      link,
      reminderId: r.id,
    });
    if (result.created) created++;
    else skipped++;
  }

  // ── Maturing-policy sweep ─────────────────────────────────────────
  // Life-family insurance policies (LIFE / TERM / ULIP / ENDOWMENT)
  // approaching their maturityAt date. Wider trigger windows than
  // premium dues because maturity events are typically planned for
  // months in advance. Dedup is title-based (no reminder row exists
  // for maturity, so the standard reminderId-keyed dedup doesn't
  // apply).
  const MATURITY_TRIGGER_DAYS = [90, 30, 7, 0] as const;
  const maturityHorizon = new Date(today);
  maturityHorizon.setUTCDate(
    maturityHorizon.getUTCDate() + Math.max(...MATURITY_TRIGGER_DAYS) + 1,
  );
  const maturingPolicies = await prisma.investment.findMany({
    where: {
      kind: "INSURANCE",
      active: true,
      maturityAt: { not: null, gte: today, lt: maturityHorizon },
      policyType: { in: ["LIFE", "TERM", "ULIP", "ENDOWMENT"] },
    },
    select: {
      id: true,
      workspaceId: true,
      name: true,
      maturityAt: true,
      policyType: true,
    },
  });
  let maturityCreated = 0;
  let maturitySkipped = 0;
  for (const p of maturingPolicies) {
    if (!p.maturityAt) continue;
    const daysOut = Math.round(
      (p.maturityAt.getTime() - today.getTime()) / 86_400_000,
    );
    if (!(MATURITY_TRIGGER_DAYS as readonly number[]).includes(daysOut)) {
      maturitySkipped++;
      continue;
    }
    const title =
      daysOut === 0
        ? `${p.name} matures today`
        : `${p.name} matures in ${daysOut} day${daysOut === 1 ? "" : "s"}`;
    // Title-based dedup since no reminderId exists for maturity events.
    // Dodge a Prisma 7 deep-instantiation quirk that fires once the
    // schema grows past a threshold — local typing keeps the result
    // shape predictable for the `if (existing)` check.
    const dedupArgs = {
      where: {
        workspaceId: p.workspaceId,
        kind: NotificationKind.POLICY_RENEWING,
        title,
      },
      select: { id: true },
    } as const;
    const existing = (await (
      prisma.notification.findFirst as unknown as (
        a: typeof dedupArgs,
      ) => Promise<{ id: string } | null>
    )(dedupArgs));
    if (existing) {
      maturitySkipped++;
      continue;
    }
    await createNotification({
      workspaceId: p.workspaceId,
      kind: NotificationKind.POLICY_RENEWING,
      title,
      body: `Maturity date: ${p.maturityAt.toISOString().slice(0, 10)}`,
      link: `/insurance/${p.id}`,
    });
    maturityCreated++;
  }

  return NextResponse.json({
    ok: true,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    scanned: reminders.length,
    created,
    skipped,
    maturity: {
      scanned: maturingPolicies.length,
      created: maturityCreated,
      skipped: maturitySkipped,
    },
  });
}
