"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import useSWR, { mutate as globalMutate } from "swr";
import { toast } from "sonner";
import { ChevronLeft, Pencil, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/utils";

type WorkspaceDetail = {
  id: string;
  name: string;
  owner: { id: string; name: string; email: string };
  memberCount: number;
  transactionEditWindowDays: number;
  editWindowDefaultDays: number;
  createdAt: string;
  role: "OWNER" | "ADMIN" | "MEMBER" | "SUPER_ADMIN";
};

const fetcher = async (url: string) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
};

export default function WorkspaceDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const { data, error } = useSWR<{ workspace: WorkspaceDetail }>(
    id ? `/api/workspaces/${id}` : null,
    fetcher,
  );

  if (error)
    return <p className="text-sm text-destructive">Workspace not found.</p>;
  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const ws = data.workspace;
  const canEdit = ws.role === "OWNER" || ws.role === "ADMIN";

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/workspaces"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground"
        >
          <ChevronLeft className="h-3 w-3" /> Workspaces
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          {ws.name}
        </h1>
        <p className="mt-1 text-xs uppercase tracking-widest text-muted-foreground">
          Your role: {ws.role}
        </p>
      </div>

      <section className="rounded-lg border bg-card p-5 space-y-3">
        <h2 className="text-sm font-semibold">Overview</h2>
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">Owner</dt>
            <dd className="mt-0.5">
              {ws.owner.name}{" "}
              <span className="text-xs text-muted-foreground">
                · {ws.owner.email}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Members</dt>
            <dd className="mt-0.5">
              {ws.memberCount}{" "}
              <Link
                href="/settings/members"
                className="text-xs text-primary underline"
              >
                manage
              </Link>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Created</dt>
            <dd className="mt-0.5">{formatDate(ws.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">ID</dt>
            <dd className="mt-0.5 font-mono text-xs">{ws.id}</dd>
          </div>
        </dl>
      </section>

      <EditWindowSection workspace={ws} canEdit={canEdit} />
    </div>
  );
}

function EditWindowSection({
  workspace: ws,
  canEdit,
}: {
  workspace: WorkspaceDetail;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(ws.transactionEditWindowDays));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-sync local value if upstream changes (e.g. after another tab saved).
  useEffect(() => {
    if (!editing) {
      /* eslint-disable react-hooks/set-state-in-effect -- mirror server-state when not editing */
      setValue(String(ws.transactionEditWindowDays));
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [ws.transactionEditWindowDays, editing]);

  async function save() {
    setError(null);
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 365) {
      setError("Enter a whole number between 0 and 365");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/workspaces/${ws.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transactionEditWindowDays: Math.floor(n) }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Failed");
        return;
      }
      toast.success("Edit window updated");
      await globalMutate(`/api/workspaces/${ws.id}`);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setEditing(false);
    setValue(String(ws.transactionEditWindowDays));
    setError(null);
  }

  const isUsingDefault =
    ws.transactionEditWindowDays === ws.editWindowDefaultDays;
  const isDisabled = ws.transactionEditWindowDays === 0;

  return (
    <section className="rounded-lg border bg-card p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Edit window</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            How many days a non-card transaction or attendance entry stays
            editable from its date. Card transactions follow a separate
            statement-close lock, and closed loans use a fixed grace
            window — neither is affected by this setting.
          </p>
        </div>
        {canEdit && !editing && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setEditing(true)}
            className="gap-1.5"
          >
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Button>
        )}
      </div>

      {editing ? (
        <div className="space-y-2">
          <label className="block">
            <span className="text-xs font-medium">Days</span>
            <Input
              type="number"
              min={0}
              max={365}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoFocus
              className="max-w-32 tabular-nums"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              0 disables the lock entirely. App-wide default is{" "}
              {ws.editWindowDefaultDays} (set via the{" "}
              <code className="rounded bg-muted px-1">EDIT_WINDOW_DAYS</code>{" "}
              env var).
            </p>
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex items-center gap-2">
            <Button onClick={save} disabled={busy} size="sm" className="gap-1.5">
              <Save className="h-3.5 w-3.5" /> Save
            </Button>
            <Button onClick={reset} disabled={busy} size="sm" variant="ghost">
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border bg-muted/30 p-3 text-sm">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums">
              {isDisabled ? "Disabled" : ws.transactionEditWindowDays}
            </span>
            {!isDisabled && (
              <span className="text-xs text-muted-foreground">
                day{ws.transactionEditWindowDays === 1 ? "" : "s"}
              </span>
            )}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {isDisabled
              ? "No time-based lock for this workspace — transactions and attendance can be edited indefinitely (other locks still apply)."
              : isUsingDefault
                ? "Matches the app-wide default."
                : `Per-workspace override (default is ${ws.editWindowDefaultDays} day${ws.editWindowDefaultDays === 1 ? "" : "s"}).`}
          </p>
        </div>
      )}
      {!canEdit && (
        <p className="text-[11px] text-muted-foreground">
          Only the workspace Owner or an Admin can change this.
        </p>
      )}
    </section>
  );
}
