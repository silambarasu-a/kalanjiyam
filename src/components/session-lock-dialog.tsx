"use client";

import { useState } from "react";
import { useSession, signOut } from "next-auth/react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Modal popup shown when the user has been idle for 2 minutes and the JWT
 * has been flagged with `reverifyRequiredAt`. The dialog blocks interaction
 * with the rest of the page and asks the user to retype their password.
 *
 * On success, /api/auth/reverify clears the flag in the JWT; the next
 * `session.update()` reads the cleared token and the dialog hides.
 */
export function SessionLockDialog() {
  const { data: session, update } = useSession();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const locked = !!session?.user && !!session.reverifyRequiredAt;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/reverify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Reverify failed");
        return;
      }
      await update();
      setPassword("");
    } catch {
      setError("Network error.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!locked) return null;

  return (
    <Dialog open={true} modal={true} disablePointerDismissal>
      <DialogContent showCloseButton={false} className="sm:max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-amber-600" /> Session locked
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          You were idle for a couple of minutes. Enter your password to keep working.
        </p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <label className="block">
            <span className="text-xs font-medium">Password</span>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoFocus
              className="mt-1"
            />
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => signOut({ callbackUrl: "/login" })}
              disabled={submitting}
            >
              Sign out
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Unlocking…" : "Unlock"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
