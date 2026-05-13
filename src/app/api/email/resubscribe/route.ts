import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyUnsubscribeToken } from "@/lib/email/unsubscribe-token";

/**
 * Re-enable email notifications via the same signed token that was
 * used to unsubscribe. Resets `emailPrefs.enabled = true` and clears
 * any per-kind allow-list so the user gets every kind by default —
 * they can narrow it again from /settings.
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
      select: { id: true },
    });
    if (!member) return err("Not found", 404);

    await prisma.workspaceMember.update({
      where: { id: result.wmId },
      data: { emailPrefs: { enabled: true, kinds: [] } },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[email/resubscribe]", e);
    return err("Internal error", 500);
  }
}
