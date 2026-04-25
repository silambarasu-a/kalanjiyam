import { NextResponse } from "next/server";
import { consumeEmailVerificationToken } from "@/lib/auth/tokens";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const token = typeof body?.token === "string" ? body.token : "";
    if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });

    const result = await consumeEmailVerificationToken(token);
    if (!result.ok) {
      const msg =
        result.reason === "expired"
          ? "This verification link has expired. Please request a new one."
          : "This verification link is invalid or has already been used.";
      return NextResponse.json({ error: msg, reason: result.reason }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[verify-email] failed:", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
