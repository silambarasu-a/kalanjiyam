"use client";

import { useEffect, useRef, useState } from "react";
import { useSession, signOut } from "next-auth/react";
import { AlarmClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TIMING, ONE_MINUTE_MS } from "@/lib/timing";

const WARN_MS = TIMING.sessionExpiryWarningMinutes * ONE_MINUTE_MS;
const TICK_MS = 1000;

/**
 * Non-dismissible expiry popup. When less than `WARN_MS` remain on the
 * session, a modal blocks the page and offers "Stay signed in"
 * (session.update({ extend: true })). Once the countdown hits zero we
 * force signOut so the user lands back on /login instead of staring at
 * stale data.
 */
export function SessionExpiryBanner() {
  const { data: session, update } = useSession();
  const [now, setNow] = useState(() => Date.now());
  const [extending, setExtending] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    tickRef.current = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, []);

  const expiresAt = session?.expiresAt ?? null;
  const locked = !!session?.reverifyRequiredAt;
  const remainingMs = expiresAt ? expiresAt - now : Infinity;
  const expired = expiresAt != null && remainingMs <= 0;

  useEffect(() => {
    if (!expired || signingOut || locked) return;
    /* eslint-disable react-hooks/set-state-in-effect -- once-only signout latch */
    setSigningOut(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    void signOut({ callbackUrl: "/login" });
  }, [expired, signingOut, locked]);

  if (!session?.user || !expiresAt) return null;
  if (locked) return null;
  if (typeof window !== "undefined" && window.location.pathname === "/locked") return null;
  if (remainingMs > WARN_MS) return null;

  const mm = Math.max(0, Math.floor(remainingMs / 60000));
  const ss = Math.max(0, Math.floor((remainingMs % 60000) / 1000))
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
    <Dialog open={true} modal={true} disablePointerDismissal>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-md rounded-2xl"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlarmClock
              className={expired ? "h-5 w-5 text-destructive" : "h-5 w-5 text-amber-600"}
            />
            {expired ? "Session expired" : "Session about to expire"}
          </DialogTitle>
        </DialogHeader>
        <div className="text-sm text-muted-foreground">
          {expired ? (
            <p>Signing you out…</p>
          ) : (
            <p>
              Your session will expire in{" "}
              <strong className="tabular-nums text-foreground">
                {mm}:{ss}
              </strong>
              . Click <strong className="text-foreground">Stay signed in</strong> to keep working,
              or sign out now.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              setSigningOut(true);
              void signOut({ callbackUrl: "/login" });
            }}
            disabled={signingOut}
          >
            Sign out
          </Button>
          {!expired && (
            <Button onClick={extend} disabled={extending || signingOut}>
              {extending ? "Extending…" : "Stay signed in"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
