import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyUnsubscribeToken } from "@/lib/email/unsubscribe-token";

/**
 * RFC 8058 one-click unsubscribe target. Gmail / Yahoo POST here with
 * an empty body and expect a 2xx. No authentication beyond the signed
 * token — that's the whole point of one-click.
 *
 * Also supports GET so users clicking the link from a non-Gmail client
 * (or from the plaintext footer) land somewhere helpful; we redirect
 * them to /unsubscribe?u=... which renders a confirmation page.
 */
function err(reason: string, status: number) {
  return NextResponse.json({ ok: false, error: reason }, { status });
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("u");
  const result = verifyUnsubscribeToken(token);
  if (!result.ok) return err(result.reason, 400);

  try {
    const member = await prisma.workspaceMember.findUnique({
      where: { id: result.wmId },
      select: { emailPrefs: true },
    });
    if (!member) return err("Not found", 404);

    const next = {
      ...((member.emailPrefs as Record<string, unknown>) ?? {}),
      enabled: false,
    };
    await prisma.workspaceMember.update({
      where: { id: result.wmId },
      data: { emailPrefs: next },
    });
    // RFC 8058 — minimal 2xx response is enough. Plaintext is friendly
    // for mail-client previewers.
    return new NextResponse("Unsubscribed", {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  } catch (e) {
    console.error("[email/unsubscribe]", e);
    return err("Internal error", 500);
  }
}

export async function GET(request: Request) {
  // Friendly redirect for human visitors. The signed token is preserved
  // so the public /unsubscribe page can show personalised state +
  // re-subscribe button without needing a login.
  const url = new URL(request.url);
  const token = url.searchParams.get("u") ?? "";
  const redirect = new URL("/unsubscribe", url);
  if (token) redirect.searchParams.set("u", token);
  return NextResponse.redirect(redirect, 303);
}
