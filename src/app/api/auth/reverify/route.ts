import { NextResponse } from "next/server";
import { compare } from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { auth, unstable_update } from "@/lib/auth";
import { reverifySchema } from "@/lib/validators";

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const body = await request.json();
    const parsed = reverifySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const user = await prisma.user.findUnique({ where: { id: session.user.id } });
    if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const ok = await compare(parsed.data.password, user.passwordHash);
    if (!ok) return NextResponse.json({ error: "Invalid password" }, { status: 400 });

    await unstable_update({ unlock: process.env.AUTH_SECRET } as unknown as Parameters<
      typeof unstable_update
    >[0]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[reverify] failed:", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
