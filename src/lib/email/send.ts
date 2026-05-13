import { getAppUrl, getFromAddress, getTransporter } from "./mailer";

export type SendEmailArgs = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /**
   * Optional category — sets `X-Entity-Ref-ID` / `X-Mailer-Category` so
   * Gmail / Yahoo can cluster repeated transactional mail under one
   * reputation bucket. Examples: "auth", "notification", "invite".
   */
  category?: string;
  /**
   * Optional one-click unsubscribe target — adds the RFC 8058
   * `List-Unsubscribe` and `List-Unsubscribe-Post` headers, which is the
   * #1 spam-folder mitigation for transactional broadcasts and is now
   * REQUIRED by Gmail and Yahoo for any sender doing >5k messages/day.
   * For lower-volume senders it's still a strong positive signal.
   */
  unsubscribeUrl?: string;
};

export async function sendEmail({
  to,
  subject,
  html,
  text,
  category,
  unsubscribeUrl,
}: SendEmailArgs): Promise<boolean> {
  try {
    const transporter = getTransporter();
    const from = getFromAddress();
    const replyTo = process.env.SMTP_REPLY_TO || undefined;
    const appUrl = getAppUrl();
    const domain = (() => {
      try {
        return new URL(appUrl).hostname || "kalanjiyam.app";
      } catch {
        return "kalanjiyam.app";
      }
    })();

    // Headers that nudge mail clients away from the spam folder. None of
    // these substitute for proper SPF / DKIM / DMARC at the DNS level —
    // see the README for the setup checklist — but they help even when
    // those are in place by signalling intent (transactional, user-
    // opted-in, with a one-click unsubscribe).
    const headers: Record<string, string> = {
      "X-Mailer": "Kalanjiyam-Mailer",
      // RFC 3834 — labels this as a system-generated mail so spam
      // filters know not to expect a human-curated From.
      "Auto-Submitted": "auto-generated",
      // RFC 2076 — same intent, older standard. Many MTAs honour both.
      Precedence: "bulk",
    };
    if (category) {
      headers["X-Entity-Ref-ID"] = `${category}-${Date.now()}`;
      headers["X-Mailer-Category"] = category;
    }
    if (unsubscribeUrl) {
      // RFC 8058 — one-click unsubscribe (List-Unsubscribe-Post). Gmail
      // surfaces a native "Unsubscribe" link in the header when both
      // are present, which dramatically reduces "report spam" clicks.
      headers["List-Unsubscribe"] = `<${unsubscribeUrl}>`;
      headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
    }

    // Stable Message-ID rooted at the configured app domain. Without
    // this, nodemailer falls back to the SMTP host's domain which often
    // doesn't match the From address and tanks DMARC alignment.
    const messageId = `<${Date.now()}.${Math.random().toString(36).slice(2, 10)}@${domain}>`;

    const info = await transporter.sendMail({
      from,
      to,
      subject,
      html,
      text,
      replyTo,
      headers,
      messageId,
    });
    console.info("[email] sent", { to, subject, messageId: info.messageId });
    return true;
  } catch (err) {
    console.error("[email] send failed", { to, subject, err });
    return false;
  }
}
