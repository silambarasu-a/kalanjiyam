import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resendVerificationSchema } from "@/lib/validators";
import { createEmailVerificationToken } from "@/lib/auth/tokens";
import { sendEmail } from "@/lib/email/send";
import { verifyEmailTemplate } from "@/lib/email/templates/verify-email";
import { getAppUrl } from "@/lib/email/mailer";
import { rateLimit } from "@/lib/auth/rate-limit";

const NEUTRAL_MESSAGE = "If that account exists and is unverified, a new link has been sent.";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = resendVerificationSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ message: NEUTRAL_MESSAGE });
    const { email } = parsed.data;

    const limit = rateLimit.resendByEmail(email);
    if (!limit.ok) return NextResponse.json({ message: NEUTRAL_MESSAGE });

    const user = await prisma.user.findUnique({ where: { email } });
    if (user && !user.emailVerified) {
      const rawToken = await createEmailVerificationToken(user.id);
      const appUrl = getAppUrl();
      const verifyUrl = `${appUrl}/verify-email?token=${encodeURIComponent(rawToken)}`;
      const ttlHours = Number(process.env.EMAIL_VERIFICATION_TTL_HOURS ?? 24);
      const tpl = verifyEmailTemplate({ name: user.name, verifyUrl, appUrl, ttlHours });
      await sendEmail({ to: user.email, subject: tpl.subject, html: tpl.html, text: tpl.text, category: "auth" });
    }

    return NextResponse.json({ message: NEUTRAL_MESSAGE });
  } catch (err) {
    console.error("[resend-verification] failed:", err);
    return NextResponse.json({ message: NEUTRAL_MESSAGE });
  }
}
