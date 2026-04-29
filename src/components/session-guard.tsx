"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSession, signOut } from "next-auth/react";

const IDLE_MS = 2 * 60 * 1000; // 2 min of no activity -> lock
const TICK_MS = 5_000;

export function SessionGuard() {
  const { data: session, status, update } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const lastActivity = useRef<number>(0);
  const hasLocked = useRef(false);
  const lockedThisMount = useRef(false);
  const updateRef = useRef(update);

  // Keep the ref pointing at the latest `update` without depending on its
  // identity in the idle effect. NextAuth recreates `update` on every session
  // refetch (refetchInterval=60); listing it as a dep would tear down and
  // restart the idle timer every minute and the user would never reach the
  // 2-minute threshold.
  useEffect(() => {
    updateRef.current = update;
  }, [update]);

  const isAuthed = !!session?.user;
  const isLocked = !!session?.reverifyRequiredAt;

  // If the JWT cookie has expired (server returns null session), the
  // server-component layout that already rendered does not re-run on its
  // own. Bounce the client to /login so they don't sit on stale data.
  useEffect(() => {
    if (status !== "unauthenticated") return;
    if (!pathname) return;
    if (pathname === "/login" || pathname.startsWith("/locked") || pathname.startsWith("/signup")) {
      return;
    }
    const callback = encodeURIComponent(pathname);
    router.replace(`/login?callbackUrl=${callback}`);
  }, [status, pathname, router]);

  // If we mount into an already-locked session, the user reloaded the page
  // (or opened a new tab) while the lock dialog was up. Sign them out instead
  // of letting them re-enter their password to bypass the lock.
  useEffect(() => {
    if (status !== "authenticated") return;
    if (!isLocked) return;
    if (lockedThisMount.current) return;
    void signOut({ callbackUrl: "/login" });
  }, [status, isLocked]);

  // Per-tab session gate. The login form sets a sessionStorage flag on
  // successful sign-in; sessionStorage is per-tab and clears on tab close.
  // If we land here authenticated but the flag is missing, this tab didn't
  // perform the login (it's a new tab, a reopened-after-close tab, or a
  // shared link that inherited the cookie from another tab). Force a
  // re-login so closing a tab really does end access.
  //
  // Security note: the flag itself contains no secret. The actual auth
  // credential is the HttpOnly session cookie (XSS-safe). XSS could fake
  // the flag but couldn't access the cookie, so this gate doesn't widen
  // the credential-leak surface.
  useEffect(() => {
    if (status !== "authenticated") return;
    if (typeof window === "undefined") return;
    if (window.sessionStorage.getItem("kalanjiyam:tab-session")) return;
    void signOut({ callbackUrl: "/login" });
  }, [status]);

  // Idle detector. Depends only on stable booleans so refetchInterval-driven
  // session refreshes don't reset the activity timer.
  useEffect(() => {
    if (!isAuthed || isLocked) return;

    lastActivity.current = Date.now();
    hasLocked.current = false;

    const bump = () => {
      lastActivity.current = Date.now();
      hasLocked.current = false;
    };
    const events = ["mousemove", "keydown", "touchstart", "click", "scroll"] as const;
    for (const e of events) window.addEventListener(e, bump, { passive: true });

    const tick = setInterval(() => {
      const idle = Date.now() - lastActivity.current;
      if (idle >= IDLE_MS && !hasLocked.current) {
        hasLocked.current = true;
        lockedThisMount.current = true;
        void updateRef.current({ lock: true });
      }
    }, TICK_MS);

    return () => {
      for (const e of events) window.removeEventListener(e, bump);
      clearInterval(tick);
    };
  }, [isAuthed, isLocked]);

  return null;
}
