type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

function hit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);
  if (!existing || existing.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }
  if (existing.count >= limit) {
    return { ok: false, retryAfterSeconds: Math.ceil((existing.resetAt - now) / 1000) };
  }
  existing.count += 1;
  return { ok: true };
}

export function getClientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

const HOUR = 60 * 60 * 1000;
const FIFTEEN_MIN = 15 * 60 * 1000;

export const rateLimit = {
  signupByIp: (ip: string) => hit(`signup:ip:${ip}`, 5, HOUR),
  forgotByIp: (ip: string) => hit(`forgot:ip:${ip}`, 10, HOUR),
  forgotByEmail: (email: string) => hit(`forgot:email:${email.toLowerCase()}`, 5, HOUR),
  resetByIp: (ip: string) => hit(`reset:ip:${ip}`, 10, HOUR),
  resendByEmail: (email: string) => hit(`resend:email:${email.toLowerCase()}`, 3, HOUR),
  // Login: short window so legitimate users keep trying; tight per-email +
  // per-IP buckets slow down credential stuffing.
  loginByEmail: (email: string) =>
    hit(`login:email:${email.toLowerCase()}`, 8, FIFTEEN_MIN),
  loginByIp: (ip: string) => hit(`login:ip:${ip}`, 30, FIFTEEN_MIN),
};

if (typeof setInterval !== "undefined") {
  const interval = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets.entries()) {
      if (bucket.resetAt < now) buckets.delete(key);
    }
  }, 10 * 60 * 1000);
  if (typeof interval === "object" && interval !== null && "unref" in interval) {
    (interval as { unref: () => void }).unref();
  }
}
