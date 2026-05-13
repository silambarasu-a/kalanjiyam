/**
 * Resolves the deployment environment for use in S3 key prefixes,
 * cron-job gating, lifecycle-rule routing, and anywhere else we want
 * "is this prod or dev" without smuggling NODE_ENV around.
 *
 * Resolution order:
 *   1. APP_ENV — explicit override, wins always.
 *   2. VERCEL_ENV — production / preview / development on Vercel.
 *   3. NODE_ENV — for local + CI.
 *
 * Output values are stable, lowercase, URL-safe so they can be dropped
 * straight into S3 keys: prod | preview | dev | test.
 */
export type AppEnv = "prod" | "preview" | "dev" | "test";

export function getAppEnv(): AppEnv {
  const explicit = (process.env.APP_ENV ?? "").trim().toLowerCase();
  if (explicit === "prod" || explicit === "production") return "prod";
  if (explicit === "preview" || explicit === "staging") return "preview";
  if (explicit === "dev" || explicit === "development") return "dev";
  if (explicit === "test") return "test";

  const vercel = (process.env.VERCEL_ENV ?? "").trim().toLowerCase();
  if (vercel === "production") return "prod";
  if (vercel === "preview") return "preview";
  if (vercel === "development") return "dev";

  const node = (process.env.NODE_ENV ?? "").trim().toLowerCase();
  if (node === "production") return "prod";
  if (node === "test") return "test";
  return "dev";
}

/**
 * Whether destructive S3 operations (lifecycle-driven expiry) are
 * allowed in this env. Production is permanent storage; dev/preview
 * are scratch space.
 */
export function isEphemeralEnv(): boolean {
  const env = getAppEnv();
  return env === "dev" || env === "preview" || env === "test";
}
