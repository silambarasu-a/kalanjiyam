import {
  COLORS,
  escapeHtml,
  renderButton,
  renderLayout,
  renderSoftPanel,
} from "./_layout";

type Args = {
  /** Headline of the email. */
  label: string;
  /** Subscription / bill / settlement amount. */
  amount: number;
  /** Whether this confirmation came from auto-pay (cron) or a manual click. */
  autopayed: boolean;
  /** "subscription" / "utility bill" / "settlement" — for the chip label. */
  kindLabel: string;
  /** "Paid from HDFC" / "Settled via Cash" / etc. */
  sourceLine: string;
  /** Optional extra meta line, e.g. "₹3,200 advance used · ₹0 from card". */
  extraLine?: string;
  /** Optional "next cycle on 12 Apr 2026" line. */
  nextLine?: string;
  link: string;
  appUrl: string;
  unsubscribeUrl?: string;
};

function formatINR(n: number): string {
  return `₹${Number(n).toLocaleString("en-IN", {
    maximumFractionDigits: 2,
  })}`;
}

export function paymentConfirmationTemplate(args: Args) {
  // Settlement subjects skip the "Paid · " prefix because the label
  // already disambiguates direction ("Received from X" / "Paid X");
  // the redundant "Paid · Received from X" reads awkwardly otherwise.
  const isSettlement = args.kindLabel.toLowerCase().startsWith("settlement");
  const subject = isSettlement
    ? `${args.label} · ${formatINR(args.amount)}`
    : args.autopayed
      ? `Auto-paid · ${args.label} (${formatINR(args.amount)})`
      : `Paid · ${args.label} (${formatINR(args.amount)})`;

  const chip = `
    <div style="margin:0 0 16px 0;">
      <span style="display:inline-block;padding:4px 10px;background:${COLORS.primaryTint};color:${COLORS.primary};border:1px solid ${COLORS.primary}22;border-radius:999px;font-size:11px;font-weight:600;letter-spacing:0.02em;text-transform:uppercase;">${escapeHtml(args.kindLabel)}${args.autopayed ? " · auto-pay" : ""}</span>
    </div>`;

  const lines: string[] = [];
  lines.push(
    `<p style="margin:0 0 8px 0;font-size:18px;font-weight:600;color:${COLORS.textDark};line-height:1.4;">${escapeHtml(args.label)}</p>`,
  );
  lines.push(
    `<p style="margin:0 0 4px 0;font-size:24px;font-weight:700;color:${COLORS.textDark};line-height:1.2;">${escapeHtml(formatINR(args.amount))}</p>`,
  );
  lines.push(
    `<p style="margin:0 0 12px 0;color:${COLORS.textMuted};font-size:13px;">${escapeHtml(args.sourceLine)}</p>`,
  );
  if (args.extraLine) {
    lines.push(
      `<p style="margin:0 0 6px 0;color:${COLORS.textMuted};font-size:12px;">${escapeHtml(args.extraLine)}</p>`,
    );
  }
  if (args.nextLine) {
    lines.push(
      `<p style="margin:0 0 12px 0;color:${COLORS.textMuted};font-size:12px;">${escapeHtml(args.nextLine)}</p>`,
    );
  }
  lines.push(renderButton("View in Kalanjiyam", args.link));

  const html = renderLayout({
    title: subject,
    preheader: `${args.label} — ${formatINR(args.amount)}`,
    bodyHtml: `${chip}${renderSoftPanel(lines.join(""))}
      <p style="margin:24px 0 0 0;font-size:12px;color:${COLORS.textMuted};line-height:1.6;">
        You're receiving this because email notifications are enabled in your Kalanjiyam profile.
        <a href="${escapeHtml(args.appUrl)}/settings" style="color:${COLORS.primary};text-decoration:underline;">Manage preferences</a>.
      </p>`,
    appUrl: args.appUrl,
    unsubscribeUrl: args.unsubscribeUrl,
  });

  const text = [
    `[${args.kindLabel}${args.autopayed ? " · auto-pay" : ""}]`,
    args.label,
    formatINR(args.amount),
    args.sourceLine,
    args.extraLine ?? "",
    args.nextLine ?? "",
    `\nDetails: ${args.link}`,
    ``,
    `— Kalanjiyam`,
    `Manage email preferences: ${args.appUrl}/settings`,
    args.unsubscribeUrl ? `Unsubscribe: ${args.unsubscribeUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text };
}
