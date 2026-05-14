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
const TRIGGER_DAYS = [7, 3, 0] as const;

const REMINDER_TO_NOTIFICATION: Record<ReminderKind, NotificationKind> = {
  INSURANCE_PREMIUM: NotificationKind.PREMIUM_DUE_SOON,
  LOAN_EMI: NotificationKind.LOAN_EMI_DUE,
  CARD_STATEMENT: NotificationKind.CARD_STATEMENT_DUE,
  SIP_BUY: NotificationKind.GENERIC,
  FD_INTEREST: NotificationKind.GENERIC,
  LEASE_PAYMENT: NotificationKind.GENERIC,
  VEHICLE_DOC_RENEWAL: NotificationKind.GENERIC,
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
    } else {
      label =
        r.investment?.name ??
        r.loan?.lender ??
        r.kind.replace(/_/g, " ").toLowerCase();
    }

    const isExpiry = r.kind === ReminderKind.VEHICLE_DOC_RENEWAL;
    const title =
      daysOut === 0
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
    const link = r.vehicleDocument?.vehicleId
      ? `/vehicles/${r.vehicleDocument.vehicleId}`
      : r.investment?.id
        ? r.investment.kind === "INSURANCE"
          ? `/insurance/${r.investment.id}`
          : `/investments/${r.investment.id}`
        : r.loan?.id
          ? `/loans/${r.loan.id}`
          : "/notifications";

    const body = isExpiry
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
    const existing = await prisma.notification.findFirst({
      where: {
        workspaceId: p.workspaceId,
        kind: NotificationKind.POLICY_RENEWING,
        title,
      },
      select: { id: true },
    });
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
