// Mirrors the app's emerald-on-white fintech palette (see src/app/globals.css).
// Hex values are duplicated here because email clients can't read CSS variables.
export const COLORS = {
  primary: "#047857",
  primarySoft: "#059669",
  primaryTint: "#ECFDF5",
  accent: "#0EA5E9",
  cta: "#047857",
  softPanel: "#ECFDF5",
  pageBg: "#FAFAFB",
  card: "#FFFFFF",
  textDark: "#0A0A0B",
  textMuted: "#6B7280",
  border: "#E5E7EB",
  white: "#FFFFFF",
};

const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

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
  const wordmark = `<span style="font-family:${FONT_STACK};font-size:20px;font-weight:600;color:${COLORS.primary};letter-spacing:-0.01em;">Kalanjiyam</span>`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <title>${escape(title)}</title>
</head>
<body style="margin:0;padding:0;background:${COLORS.pageBg};font-family:${FONT_STACK};color:${COLORS.textDark};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escape(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.pageBg};padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:${COLORS.card};border:1px solid ${COLORS.border};border-radius:12px;overflow:hidden;">
        <tr><td style="padding:24px 32px;border-bottom:1px solid ${COLORS.border};">${wordmark}</td></tr>
        <tr><td style="padding:32px;font-size:15px;line-height:1.6;color:${COLORS.textDark};">${bodyHtml}</td></tr>
        <tr><td style="padding:20px 32px 24px 32px;background:${COLORS.pageBg};border-top:1px solid ${COLORS.border};font-size:12px;color:${COLORS.textMuted};line-height:1.6;">
          &copy; ${new Date().getFullYear()} Kalanjiyam &middot; Household finance &amp; farm management
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function renderButton(label: string, href: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px auto;">
  <tr><td style="background:${COLORS.cta};border-radius:8px;">
    <a href="${escape(href)}" style="display:inline-block;padding:11px 24px;font-family:${FONT_STACK};font-size:14px;font-weight:500;color:${COLORS.white};text-decoration:none;letter-spacing:0;">${escape(label)}</a>
  </td></tr>
</table>`;
}

export function renderSoftPanel(innerHtml: string): string {
  return `<div style="background:${COLORS.softPanel};border:1px solid ${COLORS.border};border-radius:10px;padding:20px 24px;margin:20px 0;">${innerHtml}</div>`;
}

export { escape as escapeHtml };
