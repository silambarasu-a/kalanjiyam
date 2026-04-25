import nodemailer, { type Transporter } from "nodemailer";

let cached: Transporter | null = null;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Email config missing: ${name} is not set in env`);
  return value;
}

export function getTransporter(): Transporter {
  if (cached) return cached;
  const host = required("SMTP_HOST");
  const port = Number(required("SMTP_PORT"));
  const user = required("SMTP_USER");
  const pass = required("SMTP_PASS");
  const secure = port === 465; // Gmail 465 = SSL; 587 = STARTTLS
  cached = nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
  return cached;
}

export function getFromAddress(): string {
  const from = process.env.SMTP_FROM;
  if (from) return from;
  const user = process.env.SMTP_USER;
  if (!user) throw new Error("Email config missing: SMTP_FROM / SMTP_USER not set");
  return `Kalanjiyam <${user}>`;
}

export function getAppUrl(): string {
  return (process.env.APP_BASE_URL ?? process.env.AUTH_URL ?? "http://localhost:3000").replace(
    /\/$/,
    ""
  );
}
