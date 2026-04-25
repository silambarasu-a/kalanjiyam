import { NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { resetPasswordSchema } from "@/lib/validators";
import { consumePasswordResetToken, markPasswordResetTokenUsed } from "@/lib/auth/tokens";
import { sendEmail } from "@/lib/email/send";
import { passwordChangedTemplate } from "@/lib/email/templates/password-changed";
import { getAppUrl } from "@/lib/email/mailer";
import { getClientIp, rateLimit } from "@/lib/auth/rate-limit";

export async function POST(request: Request) {
  try {
    const ip = getClientIp(request);
    const limit = rateLimit.resetByIp(ip);
    if (!limit.ok) {
      return NextResponse.json(
        { error: "Too many requests. Try again later." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
      );
    }

    const body = await request.json();
    const parsed = resetPasswordSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const { token, password } = parsed.data;

    const consume = await consumePasswordResetToken(token);
    if (!consume.ok) {
      const msg =
        consume.reason === "expired"
          ? "This reset link has expired. Please request a new one."
          : consume.reason === "used"
            ? "This reset link has already been used. Please request a new one."
            : "This reset link is invalid.";
      return NextResponse.json({ error: msg, reason: consume.reason }, { status: 400 });
    }

    const passwordHash = await hash(password, 12);
    await prisma.user.update({
      where: { id: consume.userId },
      data: { passwordHash },
    });
    await markPasswordResetTokenUsed(consume.tokenId, consume.userId);

    const user = await prisma.user.findUnique({ where: { id: consume.userId } });
    if (user) {
      const tpl = passwordChangedTemplate({
        name: user.name,
        changedAt: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
        appUrl: getAppUrl(),
      });
      await sendEmail({ to: user.email, subject: tpl.subject, html: tpl.html, text: tpl.text });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[reset-password] failed:", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
