"use client";

import { useState } from "react";
import { useSession, signOut } from "next-auth/react";
import { LockKeyhole, Eye, EyeOff, Loader2, AlertCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function SessionLockDialog() {
  const { data: session, update } = useSession();
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const locked = !!session?.user && !!session.reverifyRequiredAt;
  const email = session?.user.email ?? "";
  const initials =
    session?.user.name
      ?.split(" ")
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase())
      .join("") ?? email.charAt(0).toUpperCase();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/reverify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        await update();
        setPassword("");
      } else if (res.status === 400 || res.status === 401) {
        setError("Incorrect password");
      } else {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Could not verify. Please try again.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!locked) return null;

  return (
    <>
      {/* Heavier blur layer behind the dialog overlay — the default overlay
          is bg-black/10 backdrop-blur-xs, which feels too light for a lock. */}
      <div
        aria-hidden
        className="fixed inset-0 z-[49] bg-background/30 backdrop-blur-3xl pointer-events-none"
      />
      <Dialog open={true} modal={true} disablePointerDismissal>
        <DialogContent
          showCloseButton={false}
          style={{ maxWidth: 420 }}
          className="w-full sm:max-w-md p-0 gap-0 overflow-hidden rounded-2xl shadow-2xl"
        >
          <div className="flex flex-col items-center px-8 pt-8 pb-6 text-center">
            <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-primary shadow-md ring-4 ring-primary/10">
              <LockKeyhole className="h-6 w-6 text-primary-foreground" strokeWidth={2.2} />
            </div>
            <DialogTitle className="text-xl font-semibold tracking-tight text-foreground">
              Session locked
            </DialogTitle>
            <DialogDescription className="mt-2 max-w-[280px] text-sm leading-relaxed text-muted-foreground">
              For your security, we paused your session after 2 minutes of inactivity. Enter your password to continue.
            </DialogDescription>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4 px-8 pb-8">
            <div className="flex items-center gap-3 rounded-xl border bg-muted/40 px-3 py-2">
              <Avatar className="h-9 w-9 shrink-0">
                <AvatarFallback className="bg-primary text-primary-foreground text-xs font-semibold">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1 text-left">
                <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  Signed in as
                </div>
                <div className="truncate text-sm font-medium text-foreground">
                  {email}
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="reverify-password"
                className="text-xs font-semibold text-foreground"
              >
                Password
              </label>
              <div className="relative">
                <Input
                  id="reverify-password"
                  type={showPassword ? "text" : "password"}
                  autoFocus
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={submitting}
                  aria-invalid={!!error}
                  className="h-11 rounded-lg pr-10 text-sm [&::-webkit-credentials-auto-fill-button]:mr-5"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground transition-colors hover:text-foreground"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {error && (
                <div className="mt-0.5 flex items-center gap-1.5 text-xs font-medium text-destructive">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </div>

            <Button
              type="submit"
              disabled={!password || submitting}
              className="mt-1 h-11 w-full rounded-lg text-sm font-semibold"
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Verifying
                </>
              ) : (
                "Unlock"
              )}
            </Button>

            <div className="flex items-center justify-center pt-1">
              <button
                type="button"
                onClick={() => signOut({ callbackUrl: "/login" })}
                disabled={submitting}
                className="text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
              >
                Not you?{" "}
                <span className="font-semibold underline-offset-4 hover:underline">
                  Sign out
                </span>
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
