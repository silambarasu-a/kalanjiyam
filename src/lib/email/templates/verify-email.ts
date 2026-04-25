import { escapeHtml, renderButton, renderLayout, renderSoftPanel } from "./_layout";

type Args = { name: string; verifyUrl: string; appUrl: string; ttlHours: number };

export function verifyEmailTemplate({ name, verifyUrl, appUrl, ttlHours }: Args) {
  const subject = "Verify your email address";
  const body = `
    <p style="margin:0 0 16px 0;">Dear <strong>${escapeHtml(name)}</strong>,</p>
    <p style="margin:0 0 16px 0;">Thank you for signing up with Kalanjiyam.</p>
    ${renderSoftPanel(`
      <p style="margin:0 0 12px 0;">To activate your account, please verify that this email address belongs to you by clicking the button below.</p>
      ${renderButton("Verify Email Address", verifyUrl)}
      <p style="margin:12px 0 0 0;font-size:13px;color:#64748B;text-align:center;">This link will expire in ${ttlHours} hours.</p>
    `)}
    <p style="margin:20px 0 0 0;font-size:13px;color:#64748B;">If you did not create a Kalanjiyam account, you can safely ignore this email.</p>
  `;
  const html = renderLayout({
    title: subject,
    preheader: `Verify your Kalanjiyam email to activate your account.`,
    bodyHtml: body,
    appUrl,
  });
  const text = [
    `Dear ${name},`,
    ``,
    `Thank you for signing up with Kalanjiyam.`,
    ``,
    `Verify this email address by opening the link below:`,
    verifyUrl,
    ``,
    `This link expires in ${ttlHours} hours.`,
    ``,
    `If you did not create a Kalanjiyam account, ignore this email.`,
    ``,
    `— Kalanjiyam`,
  ].join("\n");
  return { subject, html, text };
}
