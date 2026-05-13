import { NextResponse } from "next/server";
import { compare, hash } from "bcryptjs";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { changePasswordSchema } from "@/lib/validators";
import { sendEmail } from "@/lib/email/send";
import { passwordChangedTemplate } from "@/lib/email/templates/password-changed";
import { getAppUrl } from "@/lib/email/mailer";

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const body = await request.json();
    const parsed = changePasswordSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const { currentPassword, newPassword } = parsed.data;

    const user = await prisma.user.findUnique({ where: { id: session.user.id } });
    if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const ok = await compare(currentPassword, user.passwordHash);
    if (!ok) {
      return NextResponse.json({ error: "Current password is incorrect" }, { status: 400 });
    }

    const sameAsOld = await compare(newPassword, user.passwordHash);
    if (sameAsOld) {
      return NextResponse.json(
        { error: "New password must be different from your current password" },
        { status: 400 }
      );
    }

    const passwordHash = await hash(newPassword, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    const tpl = passwordChangedTemplate({
      name: user.name,
      changedAt: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
      appUrl: getAppUrl(),
    });
    await sendEmail({ to: user.email, subject: tpl.subject, html: tpl.html, text: tpl.text, category: "auth" });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[change-password] failed:", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
