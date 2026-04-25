import { auth } from "@/lib/auth";
import { checkRoutePermission, type Feature } from "@/lib/permissions";

export class WorkspaceAccessError extends Error {
  constructor(
    public status: 401 | 403,
    message: string
  ) {
    super(message);
    this.name = "WorkspaceAccessError";
  }
}

export type WorkspaceContext = {
  userId: string;
  workspaceId: string;
  role: "OWNER" | "ADMIN" | "MEMBER" | "SUPER_ADMIN";
  ownOnly: boolean;
};

export async function requireWorkspace(
  feature: Feature,
  action: "read" | "write"
): Promise<WorkspaceContext> {
  const session = await auth();
  if (!session?.user?.id) throw new WorkspaceAccessError(401, "Not authenticated");
  const workspaceId = session.user.activeWorkspaceId;
  if (!workspaceId) throw new WorkspaceAccessError(403, "No active workspace");

  const { allowed, ownOnly } = checkRoutePermission(session, feature, action);
  if (!allowed) throw new WorkspaceAccessError(403, "Forbidden");

  return {
    userId: session.user.id,
    workspaceId,
    role: (session.user.role ?? "MEMBER") as WorkspaceContext["role"],
    ownOnly,
  };
}
