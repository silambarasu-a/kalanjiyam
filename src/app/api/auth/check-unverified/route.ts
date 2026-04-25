import { NextResponse } from "next/server";
import { compare } from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { loginSchema } from "@/lib/validators";

// Support for a login UX hint: if signIn() fails, the client can POST here to
// learn whether the real cause was an unverified email (so we can show a
// "resend verification" banner) vs. bad credentials. Returns a neutral shape.
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ unverified: false });
    const { email, password } = parsed.data;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return NextResponse.json({ unverified: false });
    const ok = await compare(password, user.passwordHash);
    if (!ok) return NextResponse.json({ unverified: false });
    return NextResponse.json({ unverified: !user.emailVerified });
  } catch (err) {
    console.error("[check-unverified] failed:", err);
    return NextResponse.json({ unverified: false });
  }
}
