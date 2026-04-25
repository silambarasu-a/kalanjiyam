import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export type WorkspaceMemberContext = {
  userId: string;
  workspaceId: string;
  role: "OWNER" | "ADMIN" | "MEMBER" | "SUPER_ADMIN";
};

export class WorkspaceMgmtError extends Error {
  constructor(
    public status: 401 | 403 | 404,
    message: string
  ) {
    super(message);
    this.name = "WorkspaceMgmtError";
  }
}

export async function requireMembership(
  workspaceId: string,
  roles: Array<"OWNER" | "ADMIN" | "MEMBER" | "SUPER_ADMIN"> = ["OWNER", "ADMIN", "MEMBER"]
): Promise<WorkspaceMemberContext> {
  const session = await auth();
  if (!session?.user?.id) throw new WorkspaceMgmtError(401, "Not authenticated");
  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: session.user.id } },
  });
  if (!membership || !membership.acceptedAt) {
    throw new WorkspaceMgmtError(404, "Workspace not found");
  }
  if (!roles.includes(membership.role)) {
    throw new WorkspaceMgmtError(403, "Insufficient role");
  }
  return {
    userId: session.user.id,
    workspaceId,
    role: membership.role,
  };
}
