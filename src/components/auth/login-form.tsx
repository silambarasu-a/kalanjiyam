"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";

export function LoginForm() {
  return (
    <Suspense fallback={<p className="text-sm text-neutral-500">Loading…</p>}>
      <LoginFormInner />
    </Suspense>
  );
}

function safeCallbackUrl(raw: string | null): string {
  if (!raw) return "/dashboard";
  // Only accept same-origin paths. Reject absolute URLs, protocol-relative
  // URLs, and anything that isn't a leading single slash.
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/dashboard";
  return raw;
}

function LoginFormInner() {
  const params = useSearchParams();
  const callbackUrl = safeCallbackUrl(params.get("callbackUrl"));

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setUnverified(false);
    setResendMessage(null);
    setSubmitting(true);
    try {
      const res = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });
      if (res?.error) {
        // NextAuth only forwards a short allow-list of error types to the
        // browser. Anything else — a Prisma query that timed out waking a
        // serverless database, a misconfigured AUTH_SECRET — arrives as
        // "Configuration". Reporting those as bad credentials is what taught
        // users to just press Sign in again: the retry hit a warm connection
        // and worked, so the password looked fine after all. Name the real
        // failure instead, and don't re-send the password to
        // /api/auth/check-unverified when the server never got as far as
        // checking it.
        if (res.error !== "CredentialsSignin") {
          setError("Couldn't reach the sign-in service. Please try again in a moment.");
        } else if (res.code === "too_many_attempts") {
          setError("Too many sign-in attempts. Please wait a few minutes and try again.");
        } else {
          const check = await fetch("/api/auth/check-unverified", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email, password }),
          });
          const cdata = await check.json();
          if (cdata?.unverified) {
            setUnverified(true);
            setError("Please verify your email before logging in.");
          } else {
            setError("Invalid email or password.");
          }
        }
      } else {
        // Per-tab session gate: this flag lives in sessionStorage (which
        // is per-tab and cleared on tab close). SessionGuard checks for
        // it on every mount and forces a re-login if missing — meaning
        // closing this tab and opening a new one will require fresh
        // credentials. The flag holds no secret data; the actual auth
        // credential remains the HttpOnly session cookie.
        if (typeof window !== "undefined") {
          window.sessionStorage.setItem("kalanjiyam:tab-session", "1");
        }
        // Full-document navigation, not router.push(). The session cookie was
        // only just set by the credentials callback, and every gate that
        // decides whether /dashboard renders reads it on the server — the
        // proxy, the (app) layout's auth(). A client-side push hands the new
        // page to a router (and a client session context) that were built for
        // a signed-out visitor, and any one of them bouncing us back to /login
        // is what made the user click "Sign in" a second time. A hard nav
        // re-renders the whole tree against the cookie that now exists.
        // `submitting` is deliberately left on — the button stays disabled
        // until the browser leaves the page.
        window.location.assign(callbackUrl);
        return;
      }
    } catch {
      setError("Network error. Please try again.");
    }
    setSubmitting(false);
  }

  async function handleResend() {
    setResending(true);
    setResendMessage(null);
    try {
      const res = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      setResendMessage(data.message ?? "Check your inbox.");
    } catch {
      setResendMessage("Could not resend. Please try again.");
    } finally {
      setResending(false);
    }
  }

  return (
    <div>
      <h1 className="text-xl font-semibold mb-1">Welcome back</h1>
      <p className="text-sm text-neutral-500 mb-5">Log in to your workspace.</p>

      <form onSubmit={handleSubmit} className="space-y-3">
        <label className="block">
          <span className="block text-xs font-medium text-neutral-700 mb-1">Email</span>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900"
          />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-neutral-700 mb-1">Password</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900"
          />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {unverified && (
          <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
            <button
              type="button"
              onClick={handleResend}
              disabled={resending || !email}
              className="font-medium underline text-amber-900 disabled:opacity-50"
            >
              {resending ? "Sending..." : "Resend verification email"}
            </button>
            {resendMessage && <p className="mt-1 text-amber-900">{resendMessage}</p>}
          </div>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-primary text-primary-foreground py-2 text-sm font-medium disabled:opacity-50"
        >
          {submitting ? "Signing in..." : "Sign in"}
        </button>
      </form>

      <div className="mt-4 flex justify-between text-sm">
        <Link href="/signup" className="text-neutral-600 underline">
          Create account
        </Link>
        <Link href="/forgot-password" className="text-neutral-600 underline">
          Forgot password?
        </Link>
      </div>
    </div>
  );
}
