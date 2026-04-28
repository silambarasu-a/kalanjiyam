// Wrapper around `prisma migrate deploy` that retries on P1002 — the
// advisory-lock timeout that hits Vercel builds when:
//   * a previous build died mid-migration and the lock is still held
//     waiting for Neon's idle-connection timeout to release it, or
//   * two parallel deployments race for the same lock.
//
// Postgres advisory locks are tied to the holding session; once the
// orphaned session disconnects the lock auto-releases, so retrying with
// a backoff gets us through. Non-P1002 failures bubble up immediately.

import { spawn } from "node:child_process";

const MAX_ATTEMPTS = 6;
// Backoff: 5s, 15s, 30s, 60s, 90s, 120s — total ~5 min worst case.
const BACKOFF_SECS = [5, 15, 30, 60, 90, 120];
const ADVISORY_LOCK_ERROR = "P1002";

function run() {
  return new Promise((resolve) => {
    const child = spawn("npx", ["prisma", "migrate", "deploy"], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      const s = d.toString();
      stdout += s;
      process.stdout.write(s);
    });
    child.stderr.on("data", (d) => {
      const s = d.toString();
      stderr += s;
      process.stderr.write(s);
    });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let lastFailure = null;
for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  if (attempt > 1) {
    const wait = BACKOFF_SECS[attempt - 2] ?? 120;
    console.log(
      `\n[migrate-deploy] retrying in ${wait}s (attempt ${attempt}/${MAX_ATTEMPTS})…\n`,
    );
    await sleep(wait * 1000);
  }
  const { code, stderr } = await run();
  if (code === 0) {
    process.exit(0);
  }
  lastFailure = { code, stderr };
  // Only retry the specific advisory-lock error. Migration syntax errors,
  // missing-file errors, schema drift, etc. should fail fast.
  if (!stderr.includes(ADVISORY_LOCK_ERROR)) {
    console.error(
      "\n[migrate-deploy] failed with a non-retryable error — aborting.",
    );
    process.exit(code ?? 1);
  }
  console.error(
    `\n[migrate-deploy] hit ${ADVISORY_LOCK_ERROR} (advisory lock). Will retry.`,
  );
}

console.error(
  `\n[migrate-deploy] exhausted ${MAX_ATTEMPTS} attempts; the advisory lock never released.\n` +
    `If this persists, check whether another deployment is still running, or manually run \n` +
    `  SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = 'idle' AND application_name LIKE 'prisma%';\n` +
    `against the database to clear orphaned sessions.`,
);
process.exit(lastFailure?.code ?? 1);
