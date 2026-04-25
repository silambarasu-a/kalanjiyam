export const COLORS = {
  primary: "#F36F21",
  cta: "#E76420",
  primaryLight: "#FF8A3D",
  softPanel: "#FEF1E9",
  pageBg: "#F5F5F7",
  textDark: "#1A1A1A",
  textMuted: "#64748B",
  navy: "#0B2545",
  border: "#E2E8F0",
  white: "#FFFFFF",
};

function escape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type LayoutArgs = {
  title: string;
  preheader: string;
  bodyHtml: string;
  appUrl: string;
};

export function renderLayout({ title, preheader, bodyHtml }: LayoutArgs): string {
  const header = `<span style="font-family:Arial,Helvetica,sans-serif;font-size:24px;font-weight:700;color:${COLORS.white};letter-spacing:2px;">KALANJIYAM</span>`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <title>${escape(title)}</title>
</head>
<body style="margin:0;padding:0;background:${COLORS.pageBg};font-family:Arial,Helvetica,sans-serif;color:${COLORS.textDark};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escape(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.pageBg};padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:${COLORS.white};border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
        <tr><td style="background:${COLORS.navy};padding:24px;text-align:center;border-bottom:4px solid ${COLORS.primary};">${header}</td></tr>
        <tr><td style="padding:32px 32px 24px 32px;font-size:15px;line-height:1.6;color:${COLORS.textDark};">${bodyHtml}</td></tr>
        <tr><td style="padding:0 32px;"><hr style="border:0;border-top:1px solid ${COLORS.border};margin:0;" /></td></tr>
        <tr><td style="padding:20px 32px 28px 32px;font-size:12px;color:${COLORS.textMuted};line-height:1.6;">&copy; ${new Date().getFullYear()} Kalanjiyam</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function renderButton(label: string, href: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px auto;">
  <tr><td style="background:${COLORS.cta};border-radius:6px;">
    <a href="${escape(href)}" style="display:inline-block;padding:12px 28px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:600;color:${COLORS.white};text-decoration:none;text-transform:uppercase;letter-spacing:0.5px;">${escape(label)}</a>
  </td></tr>
</table>`;
}

export function renderSoftPanel(innerHtml: string): string {
  return `<div style="background:${COLORS.softPanel};border-top:3px solid ${COLORS.primaryLight};border-radius:6px;padding:20px 24px;margin:20px 0;">${innerHtml}</div>`;
}

export { escape as escapeHtml };
