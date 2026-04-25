"use client";

import { useEffect, useRef, useState } from "react";
import { useSession, signOut } from "next-auth/react";
import { AlarmClock } from "lucide-react";
import { Button } from "@/components/ui/button";

const WARN_MS = 2 * 60 * 1000; // Show the banner when < 2 min remain.
const TICK_MS = 1000;

/**
 * Shows a sticky amber banner when the 15-minute session is < 2 min from
 * expiry. "Stay signed in" calls session.update({ extend: true }) which the
 * JWT callback interprets as "rewind sessionStartedAt by 5 min" → user gets
 * another 10 minutes. Hidden on the /locked reverify screen.
 */
export function SessionExpiryBanner() {
  const { data: session, update } = useSession();
  const [now, setNow] = useState(() => Date.now());
  const [extending, setExtending] = useState(false);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    tickRef.current = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, []);

  if (!session?.user || !session.expiresAt) return null;
  if (session.reverifyRequiredAt) return null; // locked page takes over
  if (typeof window !== "undefined" && window.location.pathname === "/locked") return null;

  const remainingMs = session.expiresAt - now;
  if (remainingMs <= 0) {
    // Session already expired — next request will 401 / log out.
    return (
      <div className="sticky top-0 z-30 w-full bg-destructive text-white text-sm px-4 py-2 flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 font-medium">
          <AlarmClock className="h-4 w-4" /> Session expired. Please sign in again.
        </span>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => signOut({ callbackUrl: "/login" })}
        >
          Sign in
        </Button>
      </div>
    );
  }
  if (remainingMs > WARN_MS) return null;

  const mm = Math.floor(remainingMs / 60000);
  const ss = Math.floor((remainingMs % 60000) / 1000)
    .toString()
    .padStart(2, "0");

  async function extend() {
    setExtending(true);
    try {
      await update({ extend: true });
    } finally {
      setExtending(false);
    }
  }

  return (
    <div className="sticky top-0 z-30 w-full bg-amber-50 text-amber-900 border-b border-amber-200 text-sm px-4 py-2 flex items-center justify-between gap-3">
      <span className="flex items-center gap-2">
        <AlarmClock className="h-4 w-4" />
        Your session expires in{" "}
        <strong className="tabular-nums">
          {mm}:{ss}
        </strong>
      </span>
      <div className="flex gap-2">
        <Button size="sm" onClick={extend} disabled={extending}>
          {extending ? "Extending…" : "Stay signed in"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => signOut({ callbackUrl: "/login" })}
        >
          Sign out
        </Button>
      </div>
    </div>
  );
}
