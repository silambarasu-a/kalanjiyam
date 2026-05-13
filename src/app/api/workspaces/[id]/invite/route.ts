import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { inviteCreateSchema } from "@/lib/validators-workspace";
import { requireMembership, WorkspaceMgmtError } from "@/lib/workspace-guard";
import { createWorkspaceInvite } from "@/lib/auth/invite-tokens";
import { sendEmail } from "@/lib/email/send";
import { workspaceInviteTemplate } from "@/lib/email/templates/workspace-invite";
import { getAppUrl } from "@/lib/email/mailer";

const INVITE_TTL_DAYS = 7;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const ctx = await requireMembership(id, ["OWNER", "ADMIN"]);

    const body = await request.json();
    const parsed = inviteCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    // Block inviting an email that's already an accepted member.
    const existingUser = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (existingUser) {
      const alreadyMember = await prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: id, userId: existingUser.id } },
      });
      if (alreadyMember?.acceptedAt) {
        return NextResponse.json({ error: "That email is already a member." }, { status: 409 });
      }
    }

    // Block duplicate active invite.
    const duplicate = await prisma.workspaceInvite.findFirst({
      where: {
        workspaceId: id,
        email: parsed.data.email,
        acceptedAt: null,
        cancelledAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (duplicate) {
      return NextResponse.json(
        { error: "An invite is already pending for that email." },
        { status: 409 }
      );
    }

    const { invite, raw } = await createWorkspaceInvite({
      workspaceId: id,
      email: parsed.data.email,
      role: parsed.data.role,
      permissions: parsed.data.permissions ?? {},
      invitedByUserId: ctx.userId,
    });

    const [workspace, inviter] = await Promise.all([
      prisma.workspace.findUnique({ where: { id }, select: { name: true } }),
      prisma.user.findUnique({ where: { id: ctx.userId }, select: { name: true } }),
    ]);

    const appUrl = getAppUrl();
    const acceptUrl = `${appUrl}/invites/${encodeURIComponent(raw)}`;
    const tpl = workspaceInviteTemplate({
      inviterName: inviter?.name ?? "A Kalanjiyam user",
      workspaceName: workspace?.name ?? "this workspace",
      acceptUrl,
      appUrl,
      role: parsed.data.role,
      ttlDays: INVITE_TTL_DAYS,
    });
    await sendEmail({ to: invite.email, subject: tpl.subject, html: tpl.html, text: tpl.text, category: "invite" });

    return NextResponse.json({
      id: invite.id,
      email: invite.email,
      role: invite.role,
      expiresAt: invite.expiresAt.toISOString(),
    });
  } catch (err) {
    if (err instanceof WorkspaceMgmtError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[invite POST]", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
