import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { forgotPasswordSchema } from "@/lib/validators";
import { createPasswordResetToken } from "@/lib/auth/tokens";
import { sendEmail } from "@/lib/email/send";
import { passwordResetRequestTemplate } from "@/lib/email/templates/password-reset-request";
import { getAppUrl } from "@/lib/email/mailer";
import { getClientIp, rateLimit } from "@/lib/auth/rate-limit";

const NEUTRAL_MESSAGE =
  "If an account exists for that email, a password reset link has been sent.";

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(1, local.length - visible.length))}@${domain}`;
}

export async function POST(request: Request) {
  try {
    const ip = getClientIp(request);
    const ipLimit = rateLimit.forgotByIp(ip);
    if (!ipLimit.ok) {
      return NextResponse.json(
        { error: "Too many requests. Try again later." },
        { status: 429, headers: { "Retry-After": String(ipLimit.retryAfterSeconds) } }
      );
    }

    const body = await request.json();
    const parsed = forgotPasswordSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ message: NEUTRAL_MESSAGE });
    }
    const { email } = parsed.data;

    const emailLimit = rateLimit.forgotByEmail(email);
    if (!emailLimit.ok) {
      return NextResponse.json({ message: NEUTRAL_MESSAGE });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (user && user.emailVerified) {
      const rawToken = await createPasswordResetToken(user.id);
      const appUrl = getAppUrl();
      const resetUrl = `${appUrl}/reset-password?token=${encodeURIComponent(rawToken)}`;
      const ttlMinutes = Number(process.env.PASSWORD_RESET_TTL_MINUTES ?? 60);
      const tpl = passwordResetRequestTemplate({
        name: user.name,
        resetUrl,
        appUrl,
        ttlMinutes,
        maskedEmail: maskEmail(user.email),
        requestedAt: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
      });
      await sendEmail({ to: user.email, subject: tpl.subject, html: tpl.html, text: tpl.text, category: "auth" });
    }

    return NextResponse.json({ message: NEUTRAL_MESSAGE });
  } catch (err) {
    console.error("[forgot-password] failed:", err);
    return NextResponse.json({ message: NEUTRAL_MESSAGE });
  }
}
