import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * One-click unsubscribe tokens for email links.
 *
 * Encodes `(workspaceMemberId, expiry)` as a base64url payload signed
 * with HMAC-SHA256 using AUTH_SECRET. Self-contained — no DB lookup
 * needed to verify, so the public /unsubscribe page can flip prefs
 * without authenticating the visitor.
 *
 * Format: `<base64url(payloadJson)>.<base64url(hmac)>`
 */

const DEFAULT_TTL_DAYS = 365;

type Payload = {
  /** WorkspaceMember.id — the row whose emailPrefs.enabled we flip. */
  wmId: string;
  /** Unix-seconds expiry. Tokens older than this are rejected. */
  exp: number;
};

function getSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) {
    throw new Error("AUTH_SECRET is required to sign unsubscribe tokens");
  }
  return s;
}

function base64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64urlDecode(input: string): Buffer {
  const pad = input.length % 4 === 2 ? "==" : input.length % 4 === 3 ? "=" : "";
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

export function signUnsubscribeToken(
  workspaceMemberId: string,
  ttlDays = DEFAULT_TTL_DAYS,
): string {
  const payload: Payload = {
    wmId: workspaceMemberId,
    exp: Math.floor(Date.now() / 1000) + ttlDays * 24 * 60 * 60,
  };
  const payloadEncoded = base64url(JSON.stringify(payload));
  const sig = createHmac("sha256", getSecret()).update(payloadEncoded).digest();
  return `${payloadEncoded}.${base64url(sig)}`;
}

export function verifyUnsubscribeToken(
  token: string | null | undefined,
): { ok: true; wmId: string } | { ok: false; reason: string } {
  if (!token || typeof token !== "string") {
    return { ok: false, reason: "Missing token" };
  }
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, reason: "Malformed token" };
  const [payloadEncoded, sigEncoded] = parts;
  const expectedSig = createHmac("sha256", getSecret())
    .update(payloadEncoded)
    .digest();
  let givenSig: Buffer;
  try {
    givenSig = base64urlDecode(sigEncoded);
  } catch {
    return { ok: false, reason: "Malformed signature" };
  }
  if (givenSig.length !== expectedSig.length) {
    return { ok: false, reason: "Bad signature" };
  }
  if (!timingSafeEqual(givenSig, expectedSig)) {
    return { ok: false, reason: "Bad signature" };
  }
  let payload: Payload;
  try {
    payload = JSON.parse(base64urlDecode(payloadEncoded).toString("utf8"));
  } catch {
    return { ok: false, reason: "Malformed payload" };
  }
  if (
    !payload.wmId ||
    typeof payload.wmId !== "string" ||
    typeof payload.exp !== "number"
  ) {
    return { ok: false, reason: "Malformed payload" };
  }
  if (payload.exp < Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: "Token expired" };
  }
  return { ok: true, wmId: payload.wmId };
}
