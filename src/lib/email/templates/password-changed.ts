import { COLORS, escapeHtml, renderLayout, renderSoftPanel } from "./_layout";

type Args = { name: string; changedAt: string; appUrl: string };

export function passwordChangedTemplate({ name, changedAt, appUrl }: Args) {
  const subject = "Your Kalanjiyam password was changed";
  const body = `
    <p style="margin:0 0 16px 0;">Dear <strong>${escapeHtml(name)}</strong>,</p>
    ${renderSoftPanel(`
      <p style="margin:0;">The password for your Kalanjiyam account was changed on <strong>${escapeHtml(changedAt)}</strong>.</p>
    `)}
    <p style="margin:16px 0 0 0;font-size:13px;color:${COLORS.textMuted};">If this wasn't you, reset your password immediately and sign out of any active sessions.</p>
  `;
  const html = renderLayout({
    title: subject,
    preheader: "Security notice: your Kalanjiyam password was changed.",
    bodyHtml: body,
    appUrl,
  });
  const text = [
    `Dear ${name},`,
    ``,
    `Your Kalanjiyam password was changed on ${changedAt}.`,
    ``,
    `If this wasn't you, reset your password immediately.`,
    ``,
    `— Kalanjiyam`,
  ].join("\n");
  return { subject, html, text };
}
