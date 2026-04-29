import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { mergeWithDefaults, type MemberPermissions } from "@/lib/permissions";
import { getClientIp, rateLimit } from "@/lib/auth/rate-limit";
import type { WorkspaceRole } from "@/generated/prisma/client";

class TooManyAttemptsError extends CredentialsSignin {
  code = "too_many_attempts";
}

async function loadWorkspaceContext(userId: string, workspaceIdHint?: string | null) {
  const memberships = await prisma.workspaceMember.findMany({
    where: { userId, acceptedAt: { not: null } },
    select: { workspaceId: true, role: true, permissions: true },
    orderBy: { createdAt: "asc" },
  });

  if (memberships.length === 0) {
    return { activeWorkspaceId: null, role: null, permissions: null };
  }

  const preferred =
    memberships.find((m) => m.workspaceId === workspaceIdHint) ?? memberships[0];

  const permissions: MemberPermissions | null =
    preferred.role === "MEMBER" ? mergeWithDefaults(preferred.permissions) : null;

  return {
    activeWorkspaceId: preferred.workspaceId,
    role: preferred.role as WorkspaceRole,
    permissions,
  };
}

export const { handlers, signIn, signOut, auth, unstable_update } = NextAuth({
  session: { strategy: "jwt", maxAge: 15 * 60 },
  // Trust the proxy Host header (Vercel / any reverse proxy). Without this
  // NextAuth v5 rejects the credentials callback on Vercel deployments and
  // the session cookie never gets set.
  trustHost: true,
  // Override the sessionToken cookie so it's a *session cookie* — no
  // `maxAge` / `expires`, which means browsers drop it on close. The JWT
  // itself still expires after `session.maxAge` (15 min), so within a
  // single browser session the user is still logged out at the 15-min
  // mark. Without this override, NextAuth defaults the cookie's maxAge
  // to session.maxAge, which makes it a persistent cookie that survives
  // browser restarts (within the 15-min window).
  cookies: {
    sessionToken: {
      name:
        process.env.NODE_ENV === "production"
          ? "__Secure-authjs.session-token"
          : "authjs.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
  },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        if (!credentials?.email || !credentials?.password) return null;

        const email = (credentials.email as string).toLowerCase();
        const ip = request instanceof Request ? getClientIp(request) : "unknown";
        if (!rateLimit.loginByEmail(email).ok || !rateLimit.loginByIp(ip).ok) {
          throw new TooManyAttemptsError();
        }

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return null;
        const ok = await compare(credentials.password as string, user.passwordHash);
        if (!ok) return null;
        if (!user.emailVerified) return null;

        const ctx = await loadWorkspaceContext(user.id, user.activeWorkspaceId);
        const previousLogin = user.lastLoginAt;

        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          activeWorkspaceId: ctx.activeWorkspaceId,
          role: ctx.role,
          permissions: ctx.permissions,
          lastLoginAt: previousLogin?.toISOString() ?? null,
        } as unknown as import("next-auth").User;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        const u = user as typeof user & {
          activeWorkspaceId?: string | null;
          role?: WorkspaceRole | null;
          permissions?: MemberPermissions | null;
          lastLoginAt?: string | null;
        };
        token.id = u.id;
        token.activeWorkspaceId = u.activeWorkspaceId ?? null;
        token.role = u.role ?? null;
        token.permissions = u.permissions ?? null;
        token.lastLoginAt = u.lastLoginAt ?? null;
        token.sessionStartedAt = Date.now();
      }

      if (trigger === "update" && token.id) {
        const s = session as
          | {
              switchWorkspace?: string;
              extend?: boolean;
              lock?: boolean;
              unlock?: string;
            }
          | undefined;

        if (s?.switchWorkspace) {
          const membership = await prisma.workspaceMember.findUnique({
            where: {
              workspaceId_userId: {
                workspaceId: s.switchWorkspace,
                userId: token.id as string,
              },
            },
          });
          if (membership && membership.acceptedAt) {
            await prisma.user.update({
              where: { id: token.id as string },
              data: { activeWorkspaceId: s.switchWorkspace },
            });
            const ctx = await loadWorkspaceContext(token.id as string, s.switchWorkspace);
            token.activeWorkspaceId = ctx.activeWorkspaceId;
            token.role = ctx.role;
            token.permissions = ctx.permissions;
          }
        } else {
          const ctx = await loadWorkspaceContext(
            token.id as string,
            (token.activeWorkspaceId as string | null) ?? null
          );
          token.activeWorkspaceId = ctx.activeWorkspaceId;
          token.role = ctx.role;
          token.permissions = ctx.permissions;
        }

        if (s?.extend) {
          token.sessionStartedAt = Date.now() - 5 * 60 * 1000;
        }
        if (s?.lock) {
          token.reverifyRequiredAt = Date.now();
        }
        if (s?.unlock && process.env.AUTH_SECRET && s.unlock === process.env.AUTH_SECRET) {
          token.reverifyRequiredAt = null;
          token.sessionStartedAt = Date.now();
        }
      }

      if (!user && !trigger && token.role === "MEMBER" && token.activeWorkspaceId) {
        const ctx = await loadWorkspaceContext(
          token.id as string,
          token.activeWorkspaceId as string
        );
        token.permissions = ctx.permissions;
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.activeWorkspaceId = (token.activeWorkspaceId as string | null) ?? null;
        session.user.role = (token.role as import("next-auth").Session["user"]["role"]) ?? null;
        session.user.permissions = (token.permissions as MemberPermissions | null) ?? null;
        session.user.lastLoginAt = (token.lastLoginAt as string | null) ?? null;
      }
      const startedAt = (token.sessionStartedAt as number) || Date.now();
      session.expiresAt = startedAt + 15 * 60 * 1000;
      session.reverifyRequiredAt = (token.reverifyRequiredAt as number | null) ?? null;
      return session;
    },
  },
});
