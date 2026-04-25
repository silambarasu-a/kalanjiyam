import type { DefaultSession } from "next-auth";
import type { MemberPermissions } from "@/lib/permissions";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name: string;
      email: string;
      activeWorkspaceId: string | null;
      role: "OWNER" | "ADMIN" | "MEMBER" | "SUPER_ADMIN" | null;
      permissions: MemberPermissions | null;
      lastLoginAt: string | null;
    } & DefaultSession["user"];
    expiresAt: number;
    reverifyRequiredAt: number | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    activeWorkspaceId?: string | null;
    role?: "OWNER" | "ADMIN" | "MEMBER" | "SUPER_ADMIN" | null;
    permissions?: MemberPermissions | null;
    lastLoginAt?: string | null;
    sessionStartedAt?: number;
    reverifyRequiredAt?: number | null;
  }
}
