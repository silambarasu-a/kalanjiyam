import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkRoutePermission, type Feature } from "@/lib/permissions";

export class WorkspaceAccessError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404,
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

/**
 * Verify every userId belongs to a member of the given workspace. Use this
 * before accepting client-supplied `ownerUserId` / `sharedWithUserIds`
 * payloads, to prevent cross-workspace ID injection on records.
 *
 * Throws WorkspaceAccessError(400) on the first ID that isn't a member.
 * Empty / null IDs are skipped.
 */
export async function assertWorkspaceMembers(
  workspaceId: string,
  userIds: ReadonlyArray<string | null | undefined>
): Promise<void> {
  const ids = Array.from(
    new Set(userIds.filter((id): id is string => typeof id === "string" && id.length > 0))
  );
  if (ids.length === 0) return;
  const memberships = await prisma.workspaceMember.findMany({
    where: { workspaceId, userId: { in: ids }, acceptedAt: { not: null } },
    select: { userId: true },
  });
  const found = new Set(memberships.map((m) => m.userId));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new WorkspaceAccessError(400, "User is not a member of this workspace");
  }
}

/**
 * Verify a FamilyMember belongs to the given workspace. Throws
 * WorkspaceAccessError(404) when not found / belongs to another workspace.
 */
export async function assertWorkspaceFamilyMember(
  workspaceId: string,
  memberId: string | null | undefined
): Promise<void> {
  if (!memberId) return;
  const fm = await prisma.familyMember.findUnique({
    where: { id: memberId },
    select: { workspaceId: true },
  });
  if (!fm || fm.workspaceId !== workspaceId) {
    throw new WorkspaceAccessError(404, "Family member not found");
  }
}
