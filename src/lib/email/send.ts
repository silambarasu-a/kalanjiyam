import { getFromAddress, getTransporter } from "./mailer";

export type SendEmailArgs = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export async function sendEmail({ to, subject, html, text }: SendEmailArgs): Promise<boolean> {
  try {
    const transporter = getTransporter();
    const from = getFromAddress();
    const replyTo = process.env.SMTP_REPLY_TO || undefined;
    const info = await transporter.sendMail({ from, to, subject, html, text, replyTo });
    console.info("[email] sent", { to, subject, messageId: info.messageId });
    return true;
  } catch (err) {
    console.error("[email] send failed", { to, subject, err });
    return false;
  }
}
