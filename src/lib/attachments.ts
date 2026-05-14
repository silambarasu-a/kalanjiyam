import { randomBytes } from "node:crypto";
import { getAppEnv } from "@/lib/app-env";
import type { Feature } from "@/lib/permissions";

/**
 * Single source of truth for everything attachment-related. New owner
 * kinds plug in by adding a row to ATTACHMENT_POLICY — the API surface,
 * key layout, permission routing, and UI all read from this table.
 *
 * Owner kinds use SCREAMING_SNAKE because they're persisted as a Prisma
 * enum (AttachmentOwnerKind). The entity-path slug below is what shows
 * up in the S3 key — pick something stable, lowercase, and folder-safe.
 */

export type AttachmentOwnerKind =
  | "VEHICLE_DOCUMENT"
  | "INSURANCE_POLICY"
  | "CARD_STATEMENT"
  | "TRANSACTION_RECEIPT"
  | "CROP_BATCH_BILL"
  | "LOAN_DOCUMENT"
  | "INCOME_PROOF"
  | "EVENT_DOCUMENT";

export type AttachmentPolicy = {
  /** S3 path segment for this owner kind. Stable; never rename. */
  entityPath: string;
  /** Which permission feature gates create/read/delete for this kind. */
  feature: Feature;
  /** Whitelist of MIME types. Use "image/*" for any image. */
  mime: readonly string[];
  /** Hard cap, megabytes. */
  maxMB: number;
  /** Bump retention / write extra AuditLog rows for sensitive kinds. */
  sensitive: boolean;
};

export const ATTACHMENT_POLICY: Record<AttachmentOwnerKind, AttachmentPolicy> = {
  VEHICLE_DOCUMENT: {
    entityPath: "vehicle-documents",
    feature: "vehicles",
    mime: ["application/pdf", "image/*"],
    maxMB: 20,
    sensitive: false,
  },
  INSURANCE_POLICY: {
    entityPath: "insurance-policies",
    feature: "insurance",
    mime: ["application/pdf"],
    maxMB: 30,
    sensitive: false,
  },
  CARD_STATEMENT: {
    entityPath: "card-statements",
    feature: "cards",
    mime: ["application/pdf"],
    maxMB: 15,
    sensitive: false,
  },
  TRANSACTION_RECEIPT: {
    entityPath: "transaction-receipts",
    feature: "transactions",
    mime: ["application/pdf", "image/*"],
    maxMB: 10,
    sensitive: false,
  },
  CROP_BATCH_BILL: {
    entityPath: "crop-bills",
    feature: "crops",
    mime: ["application/pdf", "image/*"],
    maxMB: 20,
    sensitive: false,
  },
  LOAN_DOCUMENT: {
    entityPath: "loan-documents",
    feature: "bank_loans",
    mime: ["application/pdf"],
    maxMB: 50,
    sensitive: true,
  },
  INCOME_PROOF: {
    entityPath: "income-proofs",
    feature: "reports",
    mime: ["application/pdf", "image/*"],
    maxMB: 25,
    sensitive: true,
  },
  EVENT_DOCUMENT: {
    entityPath: "events",
    feature: "events",
    mime: ["application/pdf", "image/*"],
    maxMB: 25,
    sensitive: false,
  },
};

export const ATTACHMENT_OWNER_KINDS = Object.keys(
  ATTACHMENT_POLICY,
) as AttachmentOwnerKind[];

export function getAttachmentPolicy(
  kind: AttachmentOwnerKind,
): AttachmentPolicy {
  return ATTACHMENT_POLICY[kind];
}

/**
 * Check whether `mime` matches one of the allowed entries (supports the
 * "image/*" wildcard). Case-insensitive on the type part.
 */
export function isMimeAllowed(
  kind: AttachmentOwnerKind,
  mime: string,
): boolean {
  const policy = ATTACHMENT_POLICY[kind];
  const got = mime.trim().toLowerCase();
  return policy.mime.some((allowed) => {
    if (allowed === got) return true;
    if (allowed.endsWith("/*")) {
      const prefix = allowed.slice(0, -1); // e.g. "image/"
      return got.startsWith(prefix);
    }
    return false;
  });
}

/**
 * Build the canonical S3 key for an attachment. The layout — locked in
 * for corporate auditability — is:
 *
 *   {orgPrefix?/}{env}/workspaces/{workspaceId}/{entityPath}/{ownerId}/
 *     {yyyy}/{mm}/{uploadId}-{safeFilename}
 *
 *  - orgPrefix    AWS_S3_PREFIX, optional, for shared buckets across apps
 *  - env          prod / preview / dev / test (from APP_ENV / VERCEL_ENV)
 *  - workspaceId  hard isolation between tenants
 *  - entityPath   stable folder name per AttachmentOwnerKind
 *  - ownerId      the row id (VehicleDocument.id, CardStatement.id, ...)
 *  - yyyy/mm      pivot folders for S3-console browsability + lifecycle
 *  - uploadId     16 hex chars; collision-free across entities
 *  - safeFilename slugified original filename, capped at 80 chars, for
 *                 Content-Disposition friendliness
 */
export function buildAttachmentKey(args: {
  ownerKind: AttachmentOwnerKind;
  workspaceId: string;
  ownerId: string;
  filename: string;
  /** Override for backfills; production calls leave undefined. */
  uploadedAt?: Date;
}): string {
  const policy = ATTACHMENT_POLICY[args.ownerKind];
  const orgPrefix = process.env.AWS_S3_PREFIX
    ? process.env.AWS_S3_PREFIX.replace(/^\/+|\/+$/g, "") + "/"
    : "";
  const env = getAppEnv();
  const stamp = args.uploadedAt ?? new Date();
  const yyyy = stamp.getUTCFullYear().toString();
  const mm = String(stamp.getUTCMonth() + 1).padStart(2, "0");
  const safeName = args.filename
    .replace(/[^A-Za-z0-9_.-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(-80);
  const uploadId = randomBytes(8).toString("hex");
  return `${orgPrefix}${env}/workspaces/${args.workspaceId}/${policy.entityPath}/${args.ownerId}/${yyyy}/${mm}/${uploadId}-${safeName}`;
}

/**
 * Verify that a key (server-decided or client-echoed) lives under the
 * expected `{env}/workspaces/{workspaceId}/{entityPath}/{ownerId}/`
 * subtree. Prevents a malicious client from finalizing an Attachment
 * row that points at another workspace's / entity's S3 object.
 */
export function attachmentKeyMatchesOwner(
  key: string,
  args: {
    ownerKind: AttachmentOwnerKind;
    workspaceId: string;
    ownerId: string;
  },
): boolean {
  const policy = ATTACHMENT_POLICY[args.ownerKind];
  const orgPrefix = process.env.AWS_S3_PREFIX
    ? process.env.AWS_S3_PREFIX.replace(/^\/+|\/+$/g, "") + "/"
    : "";
  const env = getAppEnv();
  const expectedPrefix = `${orgPrefix}${env}/workspaces/${args.workspaceId}/${policy.entityPath}/${args.ownerId}/`;
  return key.startsWith(expectedPrefix);
}
