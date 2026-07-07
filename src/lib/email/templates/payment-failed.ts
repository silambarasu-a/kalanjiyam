import {
  COLORS,
  escapeHtml,
  renderButton,
  renderLayout,
  renderSoftPanel,
} from "./_layout";

type Args = {
  /** Headline — "TNEB — Jun 2026 bill", subscription name, etc. */
  label: string;
  /** The amount that failed to pay. */
  amount: number;
  /** "subscription" / "utility bill" — for the chip label. */
  kindLabel: string;
  /** Why the auto-pay couldn't be recorded. */
  reason: string;
  /** Deep link to the item so the user can pay it manually. */
  link: string;
  appUrl: string;
  unsubscribeUrl?: string;
};

function formatINR(n: number): string {
  return `₹${Number(n).toLocaleString("en-IN", {
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Auto-pay failure email. Same visual shell as the confirmation mail but
 * with an alert-red chip and a "what to do" call to action so the user
 * can settle the bill by hand before it goes overdue.
 */
export function paymentFailedTemplate(args: Args) {
  const subject = `Auto-pay failed · ${args.label} (${formatINR(args.amount)})`;

  const chip = `
    <div style="margin:0 0 16px 0;">
      <span style="display:inline-block;padding:4px 10px;background:${COLORS.dangerTint};color:${COLORS.danger};border:1px solid ${COLORS.danger}22;border-radius:999px;font-size:11px;font-weight:600;letter-spacing:0.02em;text-transform:uppercase;">${escapeHtml(args.kindLabel)} · auto-pay failed</span>
    </div>`;

  const lines: string[] = [];
  lines.push(
    `<p style="margin:0 0 8px 0;font-size:18px;font-weight:600;color:${COLORS.textDark};line-height:1.4;">${escapeHtml(args.label)}</p>`,
  );
  lines.push(
    `<p style="margin:0 0 4px 0;font-size:24px;font-weight:700;color:${COLORS.textDark};line-height:1.2;">${escapeHtml(formatINR(args.amount))}</p>`,
  );
  lines.push(
    `<p style="margin:0 0 12px 0;color:${COLORS.danger};font-size:13px;">Couldn't be auto-paid: ${escapeHtml(args.reason)}</p>`,
  );
  lines.push(
    `<p style="margin:0 0 12px 0;color:${COLORS.textMuted};font-size:12px;">No money has moved. Open it in Kalanjiyam to pay it manually or fix the payment source.</p>`,
  );
  lines.push(renderButton("Pay it in Kalanjiyam", args.link));

  const html = renderLayout({
    title: subject,
    preheader: `Auto-pay failed for ${args.label} — action needed`,
    bodyHtml: `${chip}${renderSoftPanel(lines.join(""))}
      <p style="margin:24px 0 0 0;font-size:12px;color:${COLORS.textMuted};line-height:1.6;">
        You're receiving this because auto-pay is enabled for this item.
        <a href="${escapeHtml(args.appUrl)}/settings" style="color:${COLORS.primary};text-decoration:underline;">Manage preferences</a>.
      </p>`,
    appUrl: args.appUrl,
    unsubscribeUrl: args.unsubscribeUrl,
  });

  const text = [
    `[${args.kindLabel} · auto-pay failed]`,
    args.label,
    formatINR(args.amount),
    `Reason: ${args.reason}`,
    `No money has moved. Pay it manually: ${args.link}`,
    ``,
    `— Kalanjiyam`,
    `Manage email preferences: ${args.appUrl}/settings`,
    args.unsubscribeUrl ? `Unsubscribe: ${args.unsubscribeUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text };
}
