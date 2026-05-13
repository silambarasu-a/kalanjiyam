"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type State =
  | { stage: "unsubscribing" }
  | { stage: "unsubscribed" }
  | { stage: "subscribing" }
  | { stage: "subscribed" }
  | { stage: "error"; message: string };

export default function UnsubscribePage(props: {
  searchParams: Promise<{ u?: string }>;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<State>({ stage: "unsubscribing" });

  // Resolve the token from search params (Next 16 makes searchParams a
  // promise on server components, but this is a client component so we
  // unwrap once on mount). After unwrapping we POST to the unsubscribe
  // endpoint — clicking this link is itself the intent to unsubscribe.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { u } = await props.searchParams;
      if (cancelled) return;
      if (!u) {
        setState({ stage: "error", message: "Missing token" });
        return;
      }
      setToken(u);
      const res = await fetch(`/api/email/unsubscribe?u=${encodeURIComponent(u)}`, {
        method: "POST",
      });
      if (cancelled) return;
      if (res.ok) {
        setState({ stage: "unsubscribed" });
      } else {
        const body = await res.json().catch(() => ({}));
        setState({
          stage: "error",
          message: body.error ?? "Could not unsubscribe",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.searchParams]);

  async function resubscribe() {
    if (!token) return;
    setState({ stage: "subscribing" });
    const res = await fetch(`/api/email/resubscribe?u=${encodeURIComponent(token)}`, {
      method: "POST",
    });
    if (res.ok) {
      setState({ stage: "subscribed" });
    } else {
      const body = await res.json().catch(() => ({}));
      setState({
        stage: "error",
        message: body.error ?? "Could not re-subscribe",
      });
    }
  }

  return (
    <div className="min-h-screen bg-muted/30 px-4 py-16">
      <div className="mx-auto max-w-md rounded-2xl border bg-card p-8 shadow-sm">
        <div className="text-2xl font-semibold tracking-tight text-emerald-700">
          Kalanjiyam
        </div>
        <h1 className="mt-6 text-xl font-semibold">Email preferences</h1>

        {state.stage === "unsubscribing" && (
          <p className="mt-4 text-sm text-muted-foreground">Unsubscribing…</p>
        )}

        {state.stage === "unsubscribed" && (
          <>
            <p className="mt-4 text-sm">
              You&apos;ve been unsubscribed from Kalanjiyam notification emails.
              You&apos;ll still see notifications in your in-app inbox.
            </p>
            <p className="mt-3 text-xs text-muted-foreground">
              Changed your mind? You can turn email notifications back on.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                onClick={resubscribe}
                className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
              >
                Re-subscribe
              </button>
              <Link
                href="/settings"
                className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted/40"
              >
                Manage in settings
              </Link>
            </div>
          </>
        )}

        {state.stage === "subscribing" && (
          <p className="mt-4 text-sm text-muted-foreground">Re-subscribing…</p>
        )}

        {state.stage === "subscribed" && (
          <>
            <p className="mt-4 text-sm">
              You&apos;re subscribed again. You&apos;ll start receiving email
              notifications for every kind. Narrow that down anytime from your{" "}
              <Link href="/settings" className="underline">
                settings page
              </Link>
              .
            </p>
            <div className="mt-5">
              <button
                onClick={async () => {
                  if (!token) return;
                  setState({ stage: "unsubscribing" });
                  const res = await fetch(
                    `/api/email/unsubscribe?u=${encodeURIComponent(token)}`,
                    { method: "POST" },
                  );
                  if (res.ok) setState({ stage: "unsubscribed" });
                }}
                className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted/40"
              >
                Unsubscribe again
              </button>
            </div>
          </>
        )}

        {state.stage === "error" && (
          <>
            <p className="mt-4 text-sm text-destructive">{state.message}</p>
            <p className="mt-3 text-xs text-muted-foreground">
              This link may be expired or malformed. Log in and manage email
              preferences from your settings page instead.
            </p>
            <div className="mt-5">
              <Link
                href="/settings"
                className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
              >
                Open settings
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
