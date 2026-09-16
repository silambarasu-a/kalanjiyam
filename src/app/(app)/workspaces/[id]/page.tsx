"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import useSWR, { mutate as globalMutate } from "swr";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, ChevronLeft, Pencil, RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn, formatDate } from "@/lib/utils";
import {
  DEFAULT_FUNDING_SOURCE_ORDER,
  FUNDING_SOURCE_KIND_META,
  isDefaultFundingSourceOrder,
  normalizeFundingSourceOrder,
  type FundingSourceKind,
} from "@/lib/funding-sources";
import { FUNDING_SOURCE_ORDER_KEY } from "@/lib/use-funding-sources";

type WorkspaceDetail = {
  id: string;
  name: string;
  owner: { id: string; name: string; email: string };
  memberCount: number;
  transactionEditWindowDays: number;
  farmEnabled: boolean;
  fundingSourceOrder: FundingSourceKind[];
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

      <FarmModuleSection workspace={ws} canEdit={canEdit} />

      <EditWindowSection workspace={ws} canEdit={canEdit} />

      <FundingSourceOrderSection workspace={ws} canEdit={canEdit} />
    </div>
  );
}

/**
 * Order of the groups in every "Pay from" / "Receive into" picker. Plain
 * up/down buttons rather than drag-and-drop: six rows, keyboard-friendly,
 * and it works on a phone.
 */
function FundingSourceOrderSection({
  workspace: ws,
  canEdit,
}: {
  workspace: WorkspaceDetail;
  canEdit: boolean;
}) {
  const [draft, setDraft] = useState<FundingSourceKind[] | null>(null);
  const [busy, setBusy] = useState(false);
  const saved = normalizeFundingSourceOrder(ws.fundingSourceOrder);
  const order = draft ?? saved;
  const dirty = draft !== null && draft.some((k, i) => k !== saved[i]);

  function move(index: number, delta: -1 | 1) {
    const next = [...order];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setDraft(next);
  }

  async function save(next: FundingSourceKind[]) {
    setBusy(true);
    try {
      const res = await fetch(`/api/workspaces/${ws.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fundingSourceOrder: next }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? "Failed");
        return;
      }
      toast.success("Pay-from order updated");
      await globalMutate(`/api/workspaces/${ws.id}`);
      // Every open picker reads this key — refresh so they reorder at once.
      await globalMutate(FUNDING_SOURCE_ORDER_KEY);
      setDraft(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border bg-card p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Pay-from order</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            The order groups appear in every &ldquo;Pay from&rdquo; and
            &ldquo;Receive into&rdquo; dropdown — transactions, bills,
            subscriptions, loans, contacts, wages and the rest. Put what you
            use most at the top. Groups with nothing in them are hidden.
          </p>
        </div>
        {canEdit && !isDefaultFundingSourceOrder(order) && (
          <Button
            size="sm"
            variant="ghost"
            className="gap-1.5"
            disabled={busy}
            onClick={() => setDraft([...DEFAULT_FUNDING_SOURCE_ORDER])}
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset
          </Button>
        )}
      </div>

      <ol className="divide-y rounded-lg border bg-muted/30">
        {order.map((kind, i) => {
          const meta = FUNDING_SOURCE_KIND_META[kind];
          return (
            <li
              key={kind}
              className="flex items-center gap-3 px-3 py-2 text-sm"
            >
              <span className="w-5 text-right text-xs tabular-nums text-muted-foreground">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-medium">{meta.label}</div>
                <div className="text-[11px] text-muted-foreground">
                  {meta.description}
                </div>
              </div>
              {canEdit && (
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    className={cn("h-7 w-7", i === 0 && "invisible")}
                    disabled={busy || i === 0}
                    aria-label={`Move ${meta.label} up`}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className={cn("h-7 w-7", i === order.length - 1 && "invisible")}
                    disabled={busy || i === order.length - 1}
                    aria-label={`Move ${meta.label} down`}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {canEdit ? (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="gap-1.5"
            disabled={busy || !dirty}
            onClick={() => save(order)}
          >
            <Save className="h-3.5 w-3.5" /> Save order
          </Button>
          {dirty && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setDraft(null)}
            >
              Cancel
            </Button>
          )}
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Only the workspace Owner or an Admin can change this.
        </p>
      )}
    </section>
  );
}

function FarmModuleSection({
  workspace: ws,
  canEdit,
}: {
  workspace: WorkspaceDetail;
  canEdit: boolean;
}) {
  const { update } = useSession();
  const [busy, setBusy] = useState(false);

  async function toggle(next: boolean) {
    setBusy(true);
    try {
      const res = await fetch(`/api/workspaces/${ws.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ farmEnabled: next }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? "Failed");
        return;
      }
      await globalMutate(`/api/workspaces/${ws.id}`);
      await globalMutate("/api/workspaces");
      // The farm gate reads `session.user.farmEnabled`, so the actor's own
      // JWT has to be refreshed before nav / dialogs / API calls agree with
      // what was just saved. Reload so every mounted client tree re-reads it.
      await update();
      window.location.reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border bg-card p-5 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Farm module</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Off by default. Turn it on to add crops, livestock, leases, workers
            and wages — plus farm categories and the farm fields on the
            transaction form.
          </p>
        </div>
        {canEdit && (
          <Switch
            checked={ws.farmEnabled}
            onCheckedChange={toggle}
            disabled={busy}
            aria-label="Enable farm module"
          />
        )}
      </div>

      <div className="rounded-lg border bg-muted/30 p-3 text-sm">
        <div className="font-medium">
          {ws.farmEnabled ? "Enabled" : "Disabled"}
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {ws.farmEnabled
            ? "Farm pages, categories and transaction fields are available to everyone in this workspace. Switching off hides them and any farm records — it never deletes anything."
            : "This workspace has no farm pages, farm categories or farm fields on the transaction form. Switching on reveals them, along with any farm records entered earlier and each member's saved farm permissions — nothing was deleted."}
        </p>
      </div>

      {!canEdit && (
        <p className="text-[11px] text-muted-foreground">
          Only the workspace Owner or an Admin can change this.
        </p>
      )}
    </section>
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
