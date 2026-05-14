import { prisma } from "@/lib/prisma";
import type {
  NotificationKind,
  WorkspaceMember,
  WorkspaceRole,
} from "@/generated/prisma/client";
import { sendEmail } from "@/lib/email/send";
import { getAppUrl } from "@/lib/email/mailer";
import {
  notificationKindLabel,
  notificationTemplate,
} from "@/lib/email/templates/notification";
import { signUnsubscribeToken } from "@/lib/email/unsubscribe-token";
import {
  hasPermission,
  mergeWithDefaults,
  type Feature,
} from "@/lib/permissions";

export type CreateNotificationInput = {
  workspaceId: string;
  /** Null/undefined = broadcast to every workspace member. */
  userId?: string | null;
  kind: NotificationKind;
  title: string;
  body?: string | null;
  link?: string | null;
  reminderId?: string | null;
  claimId?: string | null;
};

type EmailPrefs = {
  enabled?: boolean;
  kinds?: NotificationKind[];
};

/**
 * Which workspace feature a NotificationKind belongs to. Recipients are
 * filtered down to only those with at least `view` permission on one of
 * the mapped features — e.g. a CARD_STATEMENT_DUE email only goes to
 * members with `cards` access. `null` = no feature gate (broadcast to
 * anyone with email opt-in).
 */
const KIND_FEATURES: Record<NotificationKind, Feature[] | null> = {
  PREMIUM_DUE_SOON: ["insurance"],
  PREMIUM_OVERDUE: ["insurance"],
  POLICY_RENEWING: ["insurance"],
  CLAIM_STATUS_CHANGED: ["insurance"],
  CARD_STATEMENT_DUE: ["cards"],
  LOAN_EMI_DUE: ["bank_loans", "hand_loans", "card_emi"],
  GENERIC: null,
};

function memberHasFeatureAccess(
  m: { role: WorkspaceRole; permissions: unknown },
  kind: NotificationKind,
): boolean {
  const features = KIND_FEATURES[kind];
  if (!features || features.length === 0) return true;
  const fakeSession = {
    user: {
      id: "notification-dispatch",
      role: m.role,
      permissions: mergeWithDefaults(m.permissions),
    },
  } as Parameters<typeof hasPermission>[0];
  return features.some((f) => hasPermission(fakeSession, f, "view"));
}

/**
 * Persist a Notification row. Idempotent on `(reminderId, kind)` when
 * `reminderId` is provided — re-running the cron sweep won't duplicate.
 * Email dispatch is opt-in via WorkspaceMember.emailPrefs and only fires
 * if RESEND_API_KEY is configured; otherwise the row is created and
 * `emailedAt` stays null.
 */
export async function createNotification(
  input: CreateNotificationInput,
): Promise<{ id: string; created: boolean }> {
  // Dedup: if a reminder-sourced notification with the same kind already
  // exists for this workspace+user, return it instead of inserting a
  // duplicate. The (reminderId, kind) index makes this cheap.
  if (input.reminderId) {
    const existing = await prisma.notification.findFirst({
      where: {
        workspaceId: input.workspaceId,
        userId: input.userId ?? null,
        reminderId: input.reminderId,
        kind: input.kind,
      },
      select: { id: true },
    });
    if (existing) return { id: existing.id, created: false };
  }

  const row = await prisma.notification.create({
    data: {
      workspaceId: input.workspaceId,
      userId: input.userId ?? null,
      kind: input.kind,
      title: input.title,
      body: input.body ?? null,
      link: input.link ?? null,
      reminderId: input.reminderId ?? null,
      claimId: input.claimId ?? null,
    },
    select: { id: true },
  });

  // Best-effort email — never fails the notification create. The targeted
  // recipients are: the specific user (when userId is set), or every
  // workspace member who has opted in for this kind (when broadcast).
  void dispatchEmail(row.id, input).catch((e) => {
    console.error("[notifications] email dispatch failed", e);
  });

  return { id: row.id, created: true };
}

async function dispatchEmail(
  notificationId: string,
  input: CreateNotificationInput,
): Promise<void> {
  // SMTP gate: skip silently if the project's nodemailer transport isn't
  // configured. getTransporter() throws when SMTP_HOST / PORT / USER /
  // PASS are missing — same set used by password-reset + verification.
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) return;

  const memberWhere = {
    workspaceId: input.workspaceId,
    acceptedAt: { not: null },
    ...(input.userId ? { userId: input.userId } : {}),
  };
  const members = await prisma.workspaceMember.findMany({
    where: memberWhere,
    select: {
      id: true,
      role: true,
      permissions: true,
      emailPrefs: true,
      user: { select: { email: true, name: true } },
    },
  });
  const recipients = members.filter(
    (m) =>
      shouldEmail(
        m as { emailPrefs: WorkspaceMember["emailPrefs"] },
        input.kind,
      ) && memberHasFeatureAccess(m, input.kind),
  );
  if (recipients.length === 0) return;

  const base = getAppUrl();
  const link = input.link ? `${base}${input.link}` : null;

  let anyDelivered = false;
  for (const m of recipients) {
    const to = m.user.email;
    if (!to) continue;
    // Token is per-WorkspaceMember so each recipient's unsubscribe
    // link only flips their own emailPrefs. Long TTL so the link
    // works months after the mail was opened.
    const token = signUnsubscribeToken(m.id);
    const unsubscribeUrl = `${base}/api/email/unsubscribe?u=${encodeURIComponent(token)}`;

    const { subject, html, text } = notificationTemplate({
      title: input.title,
      body: input.body ?? null,
      link,
      kindLabel: notificationKindLabel(input.kind),
      appUrl: base,
      unsubscribeUrl,
    });

    const ok = await sendEmail({
      to,
      subject,
      text,
      html,
      // Deliverability — bulk-sender hints. These tell Gmail / Yahoo
      // that this is a low-risk transactional broadcast the user opted
      // into, and how to unsubscribe.
      category: "notification",
      unsubscribeUrl,
    });
    if (ok) anyDelivered = true;
  }

  if (anyDelivered) {
    await prisma.notification.update({
      where: { id: notificationId },
      data: { emailedAt: new Date() },
    });
  }
}


function shouldEmail(
  m: { emailPrefs: WorkspaceMember["emailPrefs"] },
  kind: NotificationKind,
): boolean {
  const prefs = (m.emailPrefs ?? {}) as EmailPrefs;
  if (!prefs.enabled) return false;
  const allowed = prefs.kinds;
  if (!allowed || allowed.length === 0) return true; // enabled = all kinds
  return allowed.includes(kind);
}
