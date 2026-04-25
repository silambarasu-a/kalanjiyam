"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";

const TICK_MS = 1000;
const WARN_MS = 5 * 60 * 1000;
const URGENT_MS = 2 * 60 * 1000;

/**
 * Always-on session countdown for the desktop top nav. Click to extend the
 * session by 10 minutes (rewinds sessionStartedAt by 5 min in the JWT).
 *
 * Colour states:
 *   > 5 min  : muted (neutral)
 *   1-5 min  : amber
 *   < 1 min  : destructive (red)
 *   expired  : destructive, label changes to "Expired"
 */
export function SessionTimer({ className }: { className?: string }) {
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
  if (session.reverifyRequiredAt) return null;

  const remainingMs = session.expiresAt - now;
  const expired = remainingMs <= 0;
  const urgent = remainingMs > 0 && remainingMs < URGENT_MS;
  const warn = remainingMs > 0 && remainingMs < WARN_MS;

  const mm = Math.max(0, Math.floor(remainingMs / 60000));
  const ss = Math.max(0, Math.floor((remainingMs % 60000) / 1000))
    .toString()
    .padStart(2, "0");
  const label = expired ? "Expired" : `${mm}:${ss}`;

  async function extend() {
    if (extending || expired) return;
    setExtending(true);
    try {
      await update({ extend: true });
    } finally {
      setExtending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={extend}
      title={expired ? "Session expired" : "Click to add 10 minutes"}
      disabled={expired || extending}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium tabular-nums transition-colors disabled:cursor-not-allowed",
        expired
          ? "bg-destructive/10 text-destructive"
          : urgent
            ? "bg-destructive/10 text-destructive hover:bg-destructive/20"
            : warn
              ? "bg-amber-100 text-amber-900 hover:bg-amber-200"
              : "bg-muted text-muted-foreground hover:bg-accent",
        className
      )}
    >
      <Clock className="h-3.5 w-3.5" />
      <span>{label}</span>
    </button>
  );
}
