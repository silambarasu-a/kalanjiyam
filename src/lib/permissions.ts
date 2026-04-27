import type { Session } from "next-auth";

export const FEATURES = [
  "workspace",
  "dashboard",
  "contacts",
  "accounts",
  "cards",
  "transactions",
  "transfers",
  "categories",
  "crops",
  "livestock",
  "leases",
  "workers",
  "wages",
  "bank_loans",
  "hand_loans",
  "card_emi",
  "investments",
  "reminders",
  "reports",
  "settings",
  "members",
] as const;

export type Feature = (typeof FEATURES)[number];
export type PermissionLevel = "hidden" | "own" | "view" | "full";

const LEVEL_ORDER: Record<PermissionLevel, number> = {
  hidden: 0,
  own: 1,
  view: 2,
  full: 3,
};

const OWNERSHIP_FEATURES: readonly Feature[] = [
  "accounts",
  "cards",
  "transactions",
  "transfers",
  "bank_loans",
  "hand_loans",
  "card_emi",
  "investments",
  "reports",
] as const;

const DEFAULT_MEMBER_PERMISSIONS: Record<Feature, PermissionLevel> = {
  workspace: "hidden",
  dashboard: "view",
  contacts: "view",
  accounts: "own",
  cards: "own",
  transactions: "own",
  transfers: "own",
  categories: "view",
  crops: "view",
  livestock: "view",
  leases: "view",
  workers: "view",
  wages: "view",
  bank_loans: "own",
  hand_loans: "own",
  card_emi: "own",
  investments: "own",
  reminders: "own",
  reports: "own",
  settings: "own",
  members: "hidden",
};

export type MemberPermissions = Record<Feature, PermissionLevel>;

export function mergeWithDefaults(raw: unknown): MemberPermissions {
  const out = { ...DEFAULT_MEMBER_PERMISSIONS };
  if (raw && typeof raw === "object") {
    for (const key of Object.keys(raw) as Feature[]) {
      const value = (raw as Record<string, unknown>)[key];
      if (typeof value === "string" && value in LEVEL_ORDER) {
        out[key] = value as PermissionLevel;
      }
    }
  }
  return out;
}

type SessionLike = Session & {
  user: {
    id: string;
    activeWorkspaceId?: string | null;
    role?: "OWNER" | "ADMIN" | "MEMBER" | "SUPER_ADMIN" | null;
    permissions?: MemberPermissions | null;
  };
};

export function getPermission(session: SessionLike | null, feature: Feature): PermissionLevel {
  if (!session?.user) return "hidden";
  const role = session.user.role;
  if (role === "OWNER" || role === "SUPER_ADMIN") return "full";
  if (role === "ADMIN") {
    if (feature === "workspace") return "view";
    return "full";
  }
  if (role === "MEMBER") {
    const perms = session.user.permissions ?? DEFAULT_MEMBER_PERMISSIONS;
    return perms[feature] ?? "hidden";
  }
  return "hidden";
}

export function hasPermission(
  session: SessionLike | null,
  feature: Feature,
  minLevel: PermissionLevel
): boolean {
  return LEVEL_ORDER[getPermission(session, feature)] >= LEVEL_ORDER[minLevel];
}

export function checkRoutePermission(
  session: SessionLike | null,
  feature: Feature,
  action: "read" | "write"
): { allowed: boolean; ownOnly: boolean } {
  const level = getPermission(session, feature);
  if (level === "hidden") return { allowed: false, ownOnly: false };
  const supportsOwn = OWNERSHIP_FEATURES.includes(feature);
  if (action === "write") {
    if (level === "full") return { allowed: true, ownOnly: false };
    if (level === "own" && supportsOwn) return { allowed: true, ownOnly: true };
    return { allowed: false, ownOnly: false };
  }
  if (LEVEL_ORDER[level] >= LEVEL_ORDER.view) return { allowed: true, ownOnly: false };
  if (level === "own" && supportsOwn) return { allowed: true, ownOnly: true };
  return { allowed: false, ownOnly: false };
}

export function visibilityFilter(session: SessionLike | null, ownOnly: boolean) {
  if (!ownOnly || !session?.user) return {};
  const uid = session.user.id;
  return {
    OR: [{ ownerUserId: uid }, { sharedWithUserIds: { has: uid } }],
  };
}

type Ownable = {
  ownerUserId?: string | null;
  sharedWithUserIds?: string[];
};

export function canAccessRecord(session: SessionLike | null, record: Ownable): boolean {
  if (!session?.user) return false;
  const role = session.user.role;
  if (role === "OWNER" || role === "ADMIN" || role === "SUPER_ADMIN") return true;
  const uid = session.user.id;
  return record.ownerUserId === uid || (record.sharedWithUserIds ?? []).includes(uid);
}

export function canModifyRecord(session: SessionLike | null, record: Ownable): boolean {
  if (!session?.user) return false;
  const role = session.user.role;
  if (role === "OWNER" || role === "ADMIN" || role === "SUPER_ADMIN") return true;
  return record.ownerUserId === session.user.id;
}
