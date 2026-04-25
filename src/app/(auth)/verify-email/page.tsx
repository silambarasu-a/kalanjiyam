"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<p className="text-sm text-neutral-500">Loading…</p>}>
      <VerifyEmailContent />
    </Suspense>
  );
}

function VerifyEmailContent() {
  const params = useSearchParams();
  const token = params.get("token");

  const [state, setState] = useState<"idle" | "loading" | "ok" | "error">(
    token ? "loading" : "idle"
  );
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const res = await fetch("/api/auth/verify-email", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const data = await res.json();
        if (res.ok) {
          setState("ok");
          setMessage("Your email has been verified. You can now log in.");
        } else {
          setState("error");
          setMessage(data.error ?? "Verification failed.");
        }
      } catch {
        setState("error");
        setMessage("Something went wrong. Please try again.");
      }
    })();
  }, [token]);

  return (
    <div className="text-center">
      <h1 className="text-xl font-semibold mb-3">Email verification</h1>
      {state === "idle" && (
        <p className="text-sm text-neutral-600">
          This page expects a verification link. Use the button in the email we sent you.
        </p>
      )}
      {state === "loading" && <p className="text-sm text-neutral-600">Verifying…</p>}
      {state === "ok" && (
        <div className="rounded border border-green-300 bg-green-50 p-4 text-sm text-green-800 mb-4">
          {message}
        </div>
      )}
      {state === "error" && (
        <div className="rounded border border-red-300 bg-red-50 p-4 text-sm text-red-800 mb-4">
          {message}
        </div>
      )}
      <Link
        href="/login"
        className="inline-block rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium"
      >
        Go to login
      </Link>
    </div>
  );
}
