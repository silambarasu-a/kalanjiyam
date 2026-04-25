"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

export function AcceptInviteButton({ token }: { token: string }) {
  const router = useRouter();
  const { update } = useSession();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/invites/${token}/accept`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to accept");
        return;
      }
      // Switch into the newly-joined workspace immediately.
      await fetch(`/api/workspaces/${data.workspaceId}/switch`, { method: "POST" });
      await update({ switchWorkspace: data.workspaceId });
      router.replace("/dashboard");
    } catch {
      setError("Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={accept}
        disabled={submitting}
        className="w-full rounded-md bg-primary text-primary-foreground py-2 text-sm font-medium disabled:opacity-50"
      >
        {submitting ? "Accepting…" : "Accept invite"}
      </button>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </>
  );
}
