import { COLORS, escapeHtml, renderButton, renderLayout, renderSoftPanel } from "./_layout";

type Args = {
  name: string;
  resetUrl: string;
  appUrl: string;
  ttlMinutes: number;
  maskedEmail: string;
  requestedAt: string;
};

export function passwordResetRequestTemplate({
  name,
  resetUrl,
  appUrl,
  ttlMinutes,
  maskedEmail,
  requestedAt,
}: Args) {
  const subject = "Reset your Kalanjiyam password";
  const body = `
    <p style="margin:0 0 16px 0;">Dear <strong>${escapeHtml(name)}</strong>,</p>
    <p style="margin:0 0 16px 0;">We received a request to reset the password for your Kalanjiyam account.</p>
    ${renderSoftPanel(`
      <p style="margin:0 0 12px 0;">Click the button below to choose a new password.</p>
      ${renderButton("Reset Password", resetUrl)}
      <p style="margin:12px 0 0 0;font-size:13px;color:${COLORS.textMuted};text-align:center;">This link will expire in ${ttlMinutes} minutes and can be used only once.</p>
    `)}
    <p style="margin:20px 0 8px 0;font-size:13px;color:${COLORS.textMuted};">If you did NOT request a password reset, you can ignore this email — your password will stay the same.</p>
    <p style="margin:24px 0 0 0;font-size:12px;color:${COLORS.textMuted};line-height:1.7;">
      <strong>Request details</strong><br />
      Requested at: ${escapeHtml(requestedAt)}<br />
      Account: ${escapeHtml(maskedEmail)}
    </p>
  `;
  const html = renderLayout({
    title: subject,
    preheader: `Reset your Kalanjiyam password. This link expires in ${ttlMinutes} minutes.`,
    bodyHtml: body,
    appUrl,
  });
  const text = [
    `Dear ${name},`,
    ``,
    `We received a request to reset your Kalanjiyam password.`,
    ``,
    `Reset link:`,
    resetUrl,
    ``,
    `This link expires in ${ttlMinutes} minutes and can be used only once.`,
    ``,
    `If you did not request this, ignore the email — your password stays the same.`,
    ``,
    `Requested at: ${requestedAt}`,
    `Account: ${maskedEmail}`,
    ``,
    `— Kalanjiyam`,
  ].join("\n");
  return { subject, html, text };
}
