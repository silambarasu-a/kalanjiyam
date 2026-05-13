import {
  COLORS,
  escapeHtml,
  renderButton,
  renderLayout,
  renderSoftPanel,
} from "./_layout";

type Args = {
  title: string;
  body: string | null;
  link: string | null;
  /** Short kind label shown as a chip, e.g. "Premium due soon". */
  kindLabel: string;
  appUrl: string;
  /** One-click unsubscribe URL with a signed token. Surfaced in the
   * footer + plain-text body so the recipient always has an out. */
  unsubscribeUrl?: string;
};

/**
 * Generic notification email — used by every NotificationKind that goes
 * out via the daily cron sweep. Matches the in-app emerald palette and
 * shares the same layout shell as password-reset / verify emails so the
 * deliverability fingerprint (DKIM, From, Reply-To, footer) is consistent.
 */
export function notificationTemplate({
  title,
  body,
  link,
  kindLabel,
  appUrl,
  unsubscribeUrl,
}: Args) {
  const subject = title;

  const chip = `
    <div style="margin:0 0 16px 0;">
      <span style="display:inline-block;padding:4px 10px;background:${COLORS.primaryTint};color:${COLORS.primary};border:1px solid ${COLORS.primary}22;border-radius:999px;font-size:11px;font-weight:600;letter-spacing:0.02em;text-transform:uppercase;">${escapeHtml(kindLabel)}</span>
    </div>`;

  const innerBody = `
    <p style="margin:0 0 8px 0;font-size:18px;font-weight:600;color:${COLORS.textDark};line-height:1.4;">${escapeHtml(title)}</p>
    ${body ? `<p style="margin:0 0 16px 0;color:${COLORS.textMuted};">${escapeHtml(body)}</p>` : ""}
    ${link ? renderButton("View in Kalanjiyam", link) : ""}
  `;

  const html = renderLayout({
    title: subject,
    preheader: body ?? title,
    bodyHtml: `${chip}${renderSoftPanel(innerBody)}
      <p style="margin:24px 0 0 0;font-size:12px;color:${COLORS.textMuted};line-height:1.6;">
        You're receiving this because email notifications are enabled in your Kalanjiyam profile.
        <a href="${escapeHtml(appUrl)}/settings" style="color:${COLORS.primary};text-decoration:underline;">Manage preferences</a>.
      </p>`,
    appUrl,
    unsubscribeUrl,
  });

  const text = [
    `[${kindLabel}]`,
    title,
    body ?? "",
    link ? `\nDetails: ${link}` : "",
    ``,
    `— Kalanjiyam`,
    `Manage email preferences: ${appUrl}/settings`,
    unsubscribeUrl ? `Unsubscribe: ${unsubscribeUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text };
}

const KIND_LABELS: Record<string, string> = {
  PREMIUM_DUE_SOON: "Premium due soon",
  PREMIUM_OVERDUE: "Premium overdue",
  POLICY_RENEWING: "Policy renewing",
  CLAIM_STATUS_CHANGED: "Claim status",
  CARD_STATEMENT_DUE: "Card statement",
  LOAN_EMI_DUE: "Loan EMI",
  GENERIC: "Reminder",
};

export function notificationKindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? "Notification";
}
