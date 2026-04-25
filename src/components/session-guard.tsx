"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

const IDLE_MS = 2 * 60 * 1000; // 2 min of no activity -> lock

export function SessionGuard() {
  const { data: session, update } = useSession();
  const router = useRouter();
  const lastActivity = useRef<number>(0);
  const hasLocked = useRef(false);

  useEffect(() => {
    if (!session) return;

    // Redirect to /locked as soon as reverifyRequiredAt is set
    if (session.reverifyRequiredAt) {
      router.replace("/locked");
      return;
    }

    lastActivity.current = Date.now();
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
    }, 10_000);

    return () => {
      for (const e of events) window.removeEventListener(e, bump);
      clearInterval(tick);
    };
  }, [session, update, router]);

  return null;
}
