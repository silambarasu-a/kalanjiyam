import { prisma } from "@/lib/prisma";
import type {
  NotificationKind,
  WorkspaceMember,
} from "@/generated/prisma/client";
import { sendEmail } from "@/lib/email/send";
import { getAppUrl } from "@/lib/email/mailer";

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
      emailPrefs: true,
      user: { select: { email: true, name: true } },
    },
  });
  const recipients = members.filter((m) =>
    shouldEmail(m as { emailPrefs: WorkspaceMember["emailPrefs"] }, input.kind),
  );
  if (recipients.length === 0) return;

  const base = getAppUrl();
  const link = input.link ? `${base}${input.link}` : null;
  const subject = input.title;
  const text = [
    input.title,
    input.body ?? "",
    link ? `\n\nDetails: ${link}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const html = renderEmailHtml({
    title: input.title,
    body: input.body ?? null,
    link,
  });

  let anyDelivered = false;
  for (const m of recipients) {
    const to = m.user.email;
    if (!to) continue;
    const ok = await sendEmail({ to, subject, text, html });
    if (ok) anyDelivered = true;
  }

  if (anyDelivered) {
    await prisma.notification.update({
      where: { id: notificationId },
      data: { emailedAt: new Date() },
    });
  }
}

function renderEmailHtml(args: {
  title: string;
  body: string | null;
  link: string | null;
}): string {
  const safe = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return [
    `<div style="font-family:-apple-system,system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111">`,
    `<h2 style="font-size:18px;margin:0 0 12px">${safe(args.title)}</h2>`,
    args.body
      ? `<p style="font-size:14px;line-height:1.5;color:#444;margin:0 0 16px">${safe(args.body)}</p>`
      : "",
    args.link
      ? `<p style="font-size:14px;margin:0"><a href="${args.link}" style="display:inline-block;padding:8px 14px;background:#111;color:#fff;border-radius:6px;text-decoration:none">Open in Kalanjiyam</a></p>`
      : "",
    `<p style="font-size:11px;color:#888;margin-top:24px">You receive these because email notifications are enabled in your profile settings.</p>`,
    `</div>`,
  ].join("");
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
