import { NextResponse } from "next/server";
import { readInvite } from "@/lib/auth/invite-tokens";

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> }
) {
  const { token } = await context.params;
  const invite = await readInvite(decodeURIComponent(token));
  if (!invite) return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  if (invite.cancelledAt) {
    return NextResponse.json({ error: "This invite was cancelled." }, { status: 410 });
  }
  if (invite.acceptedAt) {
    return NextResponse.json({ error: "This invite has already been used." }, { status: 410 });
  }
  if (invite.expiresAt.getTime() < Date.now()) {
    return NextResponse.json({ error: "This invite has expired." }, { status: 410 });
  }
  return NextResponse.json({
    email: invite.email,
    role: invite.role,
    workspaceName: invite.workspace.name,
    inviterName: invite.invitedByUser.name,
  });
}
