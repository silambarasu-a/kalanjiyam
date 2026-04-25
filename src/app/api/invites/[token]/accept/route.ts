import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { consumeInvite } from "@/lib/auth/invite-tokens";

export async function POST(
  _request: Request,
  context: { params: Promise<{ token: string }> }
) {
  const { token } = await context.params;
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const result = await consumeInvite({
    rawToken: decodeURIComponent(token),
    userId: session.user.id,
    userEmail: session.user.email,
  });
  if (!result.ok) {
    const msg =
      result.reason === "cap"
        ? "You already belong to 3 workspaces. Leave one first."
        : result.reason === "wrong_email"
          ? "This invite was sent to a different email."
          : result.reason === "expired"
            ? "This invite has expired."
            : result.reason === "used"
              ? "This invite was already used."
              : result.reason === "cancelled"
                ? "This invite was cancelled."
                : "This invite is invalid.";
    return NextResponse.json({ error: msg, reason: result.reason }, { status: 400 });
  }
  return NextResponse.json({ ok: true, workspaceId: result.workspaceId });
}
