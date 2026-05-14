import {
  S3Client,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomBytes } from "node:crypto";

/**
 * S3 client for vehicle-document attachments.
 *
 * Env (Vercel → Settings → Environment Variables):
 *   - AWS_S3_BUCKET         (required)
 *   - AWS_S3_REGION         (required, e.g. ap-south-1)
 *   - AWS_ACCESS_KEY_ID     (required)
 *   - AWS_SECRET_ACCESS_KEY (required)
 *   - AWS_S3_PREFIX         (optional — namespaces keys, e.g. "prod/")
 *
 * Uses presigned URLs so the browser uploads + downloads directly to S3.
 * Server only generates short-lived URLs (10 min upload, 5 min download)
 * and stores the bucket-relative key in `VehicleDocument.attachmentKey`.
 */

let cached: S3Client | null = null;

export class S3ConfigError extends Error {}

export function getS3(): S3Client {
  if (cached) return cached;
  const region = process.env.AWS_S3_REGION;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!region || !accessKeyId || !secretAccessKey) {
    throw new S3ConfigError(
      "S3 is not configured (AWS_S3_REGION / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY missing)",
    );
  }
  cached = new S3Client({
    region,
    credentials: { accessKeyId, secretAccessKey },
  });
  return cached;
}

export function getBucket(): string {
  const bucket = process.env.AWS_S3_BUCKET;
  if (!bucket) {
    throw new S3ConfigError("AWS_S3_BUCKET is not configured");
  }
  return bucket;
}

export function isS3Configured(): boolean {
  return !!(
    process.env.AWS_S3_BUCKET &&
    process.env.AWS_S3_REGION &&
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY
  );
}

/**
 * Build a per-workspace S3 key for a vehicle document. Random suffix
 * prevents enumeration even though the bucket should be private.
 */
export function buildVehicleDocKey(args: {
  workspaceId: string;
  vehicleId: string;
  filename: string;
}): string {
  const prefix = process.env.AWS_S3_PREFIX
    ? process.env.AWS_S3_PREFIX.replace(/^\/+|\/+$/g, "") + "/"
    : "";
  const safeName = args.filename
    .replace(/[^A-Za-z0-9_.-]+/g, "_")
    .slice(-80);
  const random = randomBytes(8).toString("hex");
  return `${prefix}workspaces/${args.workspaceId}/vehicles/${args.vehicleId}/${random}-${safeName}`;
}

export async function presignPut(
  key: string,
  contentType: string,
  expiresInSeconds = 600,
): Promise<string> {
  const cmd = new PutObjectCommand({
    Bucket: getBucket(),
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(getS3(), cmd, { expiresIn: expiresInSeconds });
}

export async function presignGet(
  key: string,
  expiresInSeconds = 300,
): Promise<string> {
  const cmd = new GetObjectCommand({
    Bucket: getBucket(),
    Key: key,
  });
  return getSignedUrl(getS3(), cmd, { expiresIn: expiresInSeconds });
}

export async function deleteObject(key: string): Promise<void> {
  const cmd = new DeleteObjectCommand({
    Bucket: getBucket(),
    Key: key,
  });
  await getS3().send(cmd);
}
