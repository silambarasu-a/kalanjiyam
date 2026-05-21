import { NextResponse } from "next/server";
import { z } from "zod";
import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { getAppUrl } from "@/lib/email/mailer";
import { sendEmail } from "@/lib/email/send";
import { renderBackupEmail, type BackupObject } from "@/lib/email/templates/db-backup";
import { getBucket, getS3, presignGet } from "@/lib/s3";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRESIGN_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days (S3 sig-v4 max)

function authorize(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const got = request.headers.get("authorization") ?? "";
  return got === `Bearer ${expected}`;
}

const SuccessSchema = z.object({
  status: z.literal("ok"),
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  runUrl: z.string().url(),
  key: z.string().min(1),
  size: z.coerce.number().int().nonnegative(),
  pruned: z.array(z.string()).default([]),
});

const FailureSchema = z.object({
  status: z.literal("fail"),
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  runUrl: z.string().url(),
});

const BodySchema = z.discriminatedUnion("status", [SuccessSchema, FailureSchema]);

function backupPrefix(): string {
  const raw = process.env.AWS_S3_BACKUP_PREFIX || "db-backups";
  return raw.replace(/^\/+|\/+$/g, "");
}

async function listCurrentBackups(): Promise<BackupObject[]> {
  const prefix = backupPrefix();
  const out = await getS3().send(
    new ListObjectsV2Command({
      Bucket: getBucket(),
      Prefix: `${prefix}/`,
    }),
  );
  const entries = (out.Contents ?? [])
    .filter((o) => o.Key?.endsWith(".dump"))
    .sort((a, b) => (b.Key ?? "").localeCompare(a.Key ?? ""));

  return Promise.all(
    entries.map(async (o) => ({
      key: o.Key!,
      size: o.Size ?? 0,
      lastModified: o.LastModified?.toISOString() ?? "",
      downloadUrl: await presignGet(o.Key!, PRESIGN_TTL_SECONDS),
    })),
  );
}

export async function POST(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const to = process.env.BACKUP_NOTIFY_EMAIL;
  if (!to) {
    return NextResponse.json(
      { error: "BACKUP_NOTIFY_EMAIL not configured" },
      { status: 500 },
    );
  }

  let parsed;
  try {
    const json = await request.json();
    parsed = BodySchema.parse(json);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Invalid body", details: message },
      { status: 400 },
    );
  }

  // Always query S3 for fresh-truth on backups currently in the bucket,
  // and stamp each with a 7-day presigned download URL. If listing fails
  // (e.g. IAM gap) we still send the email — just without the rich list.
  let kept: BackupObject[] = [];
  let listError: string | null = null;
  try {
    kept = await listCurrentBackups();
  } catch (err) {
    listError = err instanceof Error ? err.message : String(err);
    console.error("[backup-notify] listCurrentBackups failed:", listError);
  }

  const appUrl = getAppUrl();
  const email =
    parsed.status === "ok"
      ? renderBackupEmail({
          status: "ok",
          today: parsed.today,
          runUrl: parsed.runUrl,
          key: parsed.key,
          size: parsed.size,
          kept,
          pruned: parsed.pruned,
          listError,
          appUrl,
        })
      : renderBackupEmail({
          status: "fail",
          today: parsed.today,
          runUrl: parsed.runUrl,
          kept,
          listError,
          appUrl,
        });

  const ok = await sendEmail({
    to,
    subject: email.subject,
    html: email.html,
    text: email.text,
    category: parsed.status === "ok" ? "backup-ok" : "backup-fail",
  });

  if (!ok) {
    return NextResponse.json({ error: "SMTP send failed" }, { status: 502 });
  }
  return NextResponse.json({ ok: true, listedBackups: kept.length });
}
