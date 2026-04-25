import { NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { signupSchema } from "@/lib/validators";
import { createEmailVerificationToken } from "@/lib/auth/tokens";
import { sendEmail } from "@/lib/email/send";
import { verifyEmailTemplate } from "@/lib/email/templates/verify-email";
import { getAppUrl } from "@/lib/email/mailer";
import { getClientIp, rateLimit } from "@/lib/auth/rate-limit";
import { WorkspaceRole } from "@/generated/prisma/client";

const CHECK_INBOX_MESSAGE = "Check your inbox to verify your email address.";

export async function POST(request: Request) {
  try {
    const ip = getClientIp(request);
    const limit = rateLimit.signupByIp(ip);
    if (!limit.ok) {
      return NextResponse.json(
        { error: "Too many signup attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
      );
    }

    const body = await request.json();
    const parsed = signupSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const { name, email, password, workspaceName } = parsed.data;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ error: "Email already registered" }, { status: 409 });
    }

    const passwordHash = await hash(password, 12);
    const wsName = (workspaceName && workspaceName.trim()) || `${name}'s Workspace`;

    const { user } = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { name, email, passwordHash },
      });
      const workspace = await tx.workspace.create({
        data: { name: wsName, ownerUserId: user.id },
      });
      await tx.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: user.id,
          role: WorkspaceRole.OWNER,
          acceptedAt: new Date(),
        },
      });
      await tx.user.update({
        where: { id: user.id },
        data: { activeWorkspaceId: workspace.id },
      });
      return { user };
    });

    const rawToken = await createEmailVerificationToken(user.id);
    const appUrl = getAppUrl();
    const verifyUrl = `${appUrl}/verify-email?token=${encodeURIComponent(rawToken)}`;
    const ttlHours = Number(process.env.EMAIL_VERIFICATION_TTL_HOURS ?? 24);
    const tpl = verifyEmailTemplate({ name, verifyUrl, appUrl, ttlHours });
    await sendEmail({ to: email, subject: tpl.subject, html: tpl.html, text: tpl.text });

    return NextResponse.json({
      message: CHECK_INBOX_MESSAGE,
      email,
      verificationPending: true,
    });
  } catch (err) {
    console.error("[signup] failed:", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
