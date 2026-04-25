"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

const IDLE_MS = 2 * 60 * 1000; // 2 min of no activity -> lock
const TICK_MS = 5_000;

export function SessionGuard() {
  const { data: session, status, update } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const lastActivity = useRef<number>(0);
  const hasLocked = useRef(false);

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
        void update({ lock: true });
      }
    }, TICK_MS);

    return () => {
      for (const e of events) window.removeEventListener(e, bump);
      clearInterval(tick);
    };
  }, [isAuthed, isLocked, update]);

  return null;
}
