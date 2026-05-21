import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { timingSafeEqual } from "node:crypto";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getBucket, getS3, S3ConfigError } from "@/lib/s3";

export const runtime = "nodejs";
// Disable Next's static optimisation — this endpoint shells out to
// pg_restore and must always execute server-side per request.
export const dynamic = "force-dynamic";

const ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function isLocalHost(host: string | null): boolean {
  if (!host) return false;
  const hostname = host.split(":")[0]?.toLowerCase() ?? "";
  return ALLOWED_HOSTS.has(hostname);
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

type RestoreBody = {
  date?: string;
  confirm?: string;
  dryRun?: boolean;
};

export async function POST(request: Request) {
  // ─── Layer 1: never run in production ────────────────────────────────
  if (process.env.NODE_ENV === "production" || process.env.VERCEL === "1") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // ─── Layer 2: must be hit via localhost ──────────────────────────────
  const host = request.headers.get("host");
  if (!isLocalHost(host)) {
    return NextResponse.json(
      { error: "Restore must be invoked from localhost" },
      { status: 403 },
    );
  }

  // ─── Layer 3: Bearer RESTORE_SECRET (timing-safe, min 24 chars) ──────
  const expected = process.env.RESTORE_SECRET;
  if (!expected || expected.length < 24) {
    return NextResponse.json(
      { error: "RESTORE_SECRET not configured (must be >= 24 chars)" },
      { status: 500 },
    );
  }
  const auth = request.headers.get("authorization") ?? "";
  const got = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!got || !safeEqual(got, expected)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // ─── Layer 4: explicit body confirmation + valid date ────────────────
  let body: RestoreBody;
  try {
    body = (await request.json()) as RestoreBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body?.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
    return NextResponse.json(
      { error: "Body must include date: 'YYYY-MM-DD'" },
      { status: 400 },
    );
  }
  if (body.confirm !== "RESTORE") {
    return NextResponse.json(
      { error: "Body must include confirm: 'RESTORE'" },
      { status: 400 },
    );
  }

  const databaseUrl = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
  if (!databaseUrl) {
    return NextResponse.json(
      { error: "DATABASE_URL not configured" },
      { status: 500 },
    );
  }
  // Refuse to point pg_restore at a hosted DB even by mistake.
  if (!/(^|@)(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(databaseUrl)) {
    return NextResponse.json(
      { error: "Refusing to restore against a non-local DATABASE_URL" },
      { status: 403 },
    );
  }

  const prefixRaw = process.env.AWS_S3_BACKUP_PREFIX || "db-backups";
  const prefix = prefixRaw.replace(/^\/+|\/+$/g, "");
  const key = `${prefix}/${body.date}.dump`;

  // ─── Fetch from S3 ───────────────────────────────────────────────────
  let s3Body: Readable;
  let size: number | undefined;
  let lastModified: Date | undefined;
  try {
    const obj = await getS3().send(
      new GetObjectCommand({ Bucket: getBucket(), Key: key }),
    );
    if (!obj.Body) {
      return NextResponse.json(
        { error: `Backup not found at s3://${getBucket()}/${key}` },
        { status: 404 },
      );
    }
    s3Body = obj.Body as Readable;
    size = obj.ContentLength;
    lastModified = obj.LastModified;
  } catch (err) {
    if (err instanceof S3ConfigError) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Failed to fetch s3://${getBucket()}/${key}: ${message}` },
      { status: 404 },
    );
  }

  if (body.dryRun) {
    // Drain the stream so the SDK doesn't leak the socket.
    s3Body.resume();
    return NextResponse.json({
      ok: true,
      dryRun: true,
      key,
      size,
      lastModified,
    });
  }

  // ─── Stream into pg_restore ──────────────────────────────────────────
  return runPgRestore(s3Body, databaseUrl, key);
}

async function runPgRestore(
  source: Readable,
  databaseUrl: string,
  key: string,
): Promise<NextResponse> {
  return new Promise((resolve) => {
    const args = [
      "--clean",
      "--if-exists",
      "--no-owner",
      "--no-privileges",
      "--single-transaction",
      "--exit-on-error",
      "--dbname",
      databaseUrl,
    ];
    let proc;
    try {
      proc = spawn("pg_restore", args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: process.env,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      resolve(
        NextResponse.json(
          {
            error: `Failed to spawn pg_restore: ${message}. Is the Postgres client installed locally?`,
          },
          { status: 500 },
        ),
      );
      return;
    }

    let stderr = "";
    let stdout = "";
    proc.stderr.on("data", (b: Buffer) => {
      stderr += b.toString("utf8");
    });
    proc.stdout.on("data", (b: Buffer) => {
      stdout += b.toString("utf8");
    });

    source.on("error", (err: Error) => {
      proc.kill("SIGTERM");
      resolve(
        NextResponse.json(
          { error: `S3 stream error: ${err.message}` },
          { status: 500 },
        ),
      );
    });

    proc.on("error", (err: Error) => {
      resolve(
        NextResponse.json(
          { error: `pg_restore spawn error: ${err.message}` },
          { status: 500 },
        ),
      );
    });

    proc.on("close", (code) => {
      const tail = (s: string, n: number) =>
        s.split("\n").slice(-n).join("\n");
      if (code === 0) {
        resolve(
          NextResponse.json({
            ok: true,
            key,
            stderrTail: tail(stderr, 20),
          }),
        );
      } else {
        resolve(
          NextResponse.json(
            {
              error: `pg_restore exited with code ${code}`,
              stderrTail: tail(stderr, 60),
              stdoutTail: tail(stdout, 20),
            },
            { status: 500 },
          ),
        );
      }
    });

    source.pipe(proc.stdin);
  });
}
