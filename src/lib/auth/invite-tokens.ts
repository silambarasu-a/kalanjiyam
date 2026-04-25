import { generateRawToken, hashToken } from "@/lib/auth/tokens";
import { prisma } from "@/lib/prisma";

const INVITE_TTL_DAYS = 7;

export async function createWorkspaceInvite(args: {
  workspaceId: string;
  email: string;
  role: "OWNER" | "ADMIN" | "MEMBER" | "SUPER_ADMIN";
  permissions: Record<string, string>;
  invitedByUserId: string;
}) {
  const raw = generateRawToken();
  const tokenHash = hashToken(raw);
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
  const invite = await prisma.workspaceInvite.create({
    data: {
      workspaceId: args.workspaceId,
      email: args.email.toLowerCase(),
      role: args.role,
      permissions: args.permissions,
      tokenHash,
      expiresAt,
      invitedByUserId: args.invitedByUserId,
    },
  });
  return { invite, raw };
}

export async function readInvite(raw: string) {
  const tokenHash = hashToken(raw);
  return prisma.workspaceInvite.findUnique({
    where: { tokenHash },
    include: {
      workspace: { select: { id: true, name: true } },
      invitedByUser: { select: { name: true, email: true } },
    },
  });
}

export async function consumeInvite(args: {
  rawToken: string;
  userId: string;
  userEmail: string;
}) {
  const tokenHash = hashToken(args.rawToken);
  const invite = await prisma.workspaceInvite.findUnique({ where: { tokenHash } });
  if (!invite) return { ok: false as const, reason: "invalid" as const };
  if (invite.acceptedAt) return { ok: false as const, reason: "used" as const };
  if (invite.cancelledAt) return { ok: false as const, reason: "cancelled" as const };
  if (invite.expiresAt.getTime() < Date.now())
    return { ok: false as const, reason: "expired" as const };
  if (invite.email.toLowerCase() !== args.userEmail.toLowerCase())
    return { ok: false as const, reason: "wrong_email" as const };

  // Enforce 3-workspace cap on the invitee.
  const memberships = await prisma.workspaceMember.count({
    where: { userId: args.userId, acceptedAt: { not: null } },
  });
  if (memberships >= 3) return { ok: false as const, reason: "cap" as const };

  // Avoid duplicate membership.
  const existing = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: invite.workspaceId, userId: args.userId } },
  });
  if (existing && existing.acceptedAt) {
    await prisma.workspaceInvite.update({
      where: { id: invite.id },
      data: { acceptedAt: new Date() },
    });
    return { ok: true as const, workspaceId: invite.workspaceId, alreadyMember: true };
  }

  await prisma.$transaction([
    prisma.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: invite.workspaceId, userId: args.userId } },
      update: { role: invite.role, permissions: invite.permissions ?? {}, acceptedAt: new Date() },
      create: {
        workspaceId: invite.workspaceId,
        userId: args.userId,
        role: invite.role,
        permissions: invite.permissions ?? {},
        acceptedAt: new Date(),
      },
    }),
    prisma.workspaceInvite.update({
      where: { id: invite.id },
      data: { acceptedAt: new Date() },
    }),
  ]);

  return { ok: true as const, workspaceId: invite.workspaceId, alreadyMember: false };
}
