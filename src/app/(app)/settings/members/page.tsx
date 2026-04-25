"use client";

import { useEffect, useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { useSession } from "next-auth/react";
import { UserPlus, Trash2, Sliders } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FEATURES, type PermissionLevel } from "@/lib/permissions";

type Member = {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: "OWNER" | "ADMIN" | "MEMBER" | "SUPER_ADMIN";
  permissions: Record<string, PermissionLevel>;
};

type Invite = { id: string; email: string; role: string; expiresAt: string };

const fetcher = (url: string) => fetch(url).then((r) => r.json());
const LEVELS: PermissionLevel[] = ["hidden", "own", "view", "full"];

export default function MembersPage() {
  const { data: session } = useSession();
  const wsId = session?.user.activeWorkspaceId ?? null;
  const key = wsId ? `/api/workspaces/${wsId}/members` : null;
  const { data, isLoading } = useSWR<{ members: Member[]; invites: Invite[] }>(key, fetcher);

  const myRole = session?.user.role ?? "MEMBER";
  const canManage = myRole === "OWNER" || myRole === "ADMIN";
  const canAssignAdmin = myRole === "OWNER";

  const [inviteOpen, setInviteOpen] = useState(false);
  const [permEditor, setPermEditor] = useState<Member | null>(null);

  if (!wsId) {
    return <p className="text-sm text-muted-foreground">No active workspace.</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Members &amp; Roles</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage who has access to this workspace and what they can do.
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setInviteOpen(true)} className="gap-2">
            <UserPlus className="h-4 w-4" /> Invite member
          </Button>
        )}
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      <section>
        <h2 className="text-sm font-semibold mb-2">Members</h2>
        <div className="rounded-lg border bg-card divide-y">
          {(data?.members ?? []).map((m) => (
            <div key={m.id} className="flex items-center gap-3 px-5 py-3">
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{m.name}</div>
                <div className="text-xs text-muted-foreground truncate">{m.email}</div>
              </div>
              <RoleBadge role={m.role} />
              {canManage && m.role !== "OWNER" && (
                <>
                  {m.role === "MEMBER" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPermEditor(m)}
                      className="gap-1"
                    >
                      <Sliders className="h-3 w-3" /> Permissions
                    </Button>
                  )}
                  {canAssignAdmin && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        await fetch(`/api/workspaces/${wsId}/members/${m.id}`, {
                          method: "PATCH",
                          headers: { "content-type": "application/json" },
                          body: JSON.stringify({
                            role: m.role === "ADMIN" ? "MEMBER" : "ADMIN",
                          }),
                        });
                        globalMutate(key);
                      }}
                    >
                      {m.role === "ADMIN" ? "Demote" : "Promote to Admin"}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={async () => {
                      if (!confirm(`Remove ${m.name} from this workspace?`)) return;
                      await fetch(`/api/workspaces/${wsId}/members/${m.id}`, {
                        method: "DELETE",
                      });
                      globalMutate(key);
                    }}
                    aria-label="Remove"
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </>
              )}
            </div>
          ))}
        </div>
      </section>

      {(data?.invites?.length ?? 0) > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-2">Pending invites</h2>
          <div className="rounded-lg border bg-card divide-y">
            {data!.invites.map((i) => (
              <div key={i.id} className="flex items-center gap-3 px-5 py-3">
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{i.email}</div>
                  <div className="text-xs text-muted-foreground">
                    Invited as {i.role} · expires {new Date(i.expiresAt).toLocaleDateString()}
                  </div>
                </div>
                {canManage && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      await fetch(`/api/workspaces/${wsId}/invite/${i.id}`, {
                        method: "DELETE",
                      });
                      globalMutate(key);
                    }}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <InviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        workspaceId={wsId}
        canAssignAdmin={canAssignAdmin}
        onInvited={() => globalMutate(key)}
      />
      <PermissionsDialog
        member={permEditor}
        workspaceId={wsId}
        onClose={() => setPermEditor(null)}
        onSaved={() => globalMutate(key)}
      />
    </div>
  );
}

function RoleBadge({ role }: { role: string }) {
  const color =
    role === "OWNER"
      ? "bg-primary text-primary-foreground"
      : role === "ADMIN"
        ? "bg-secondary text-secondary-foreground"
        : "bg-muted text-muted-foreground";
  return (
    <span className={`rounded px-2 py-0.5 text-[10px] uppercase tracking-widest ${color}`}>
      {role}
    </span>
  );
}

function InviteDialog({
  open,
  onOpenChange,
  workspaceId,
  canAssignAdmin,
  onInvited,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  workspaceId: string;
  canAssignAdmin: boolean;
  onInvited: () => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"ADMIN" | "MEMBER">("MEMBER");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/invite`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      const body = await res.json();
      if (!res.ok) setError(body.error ?? "Failed");
      else {
        setEmail("");
        setRole("MEMBER");
        onInvited();
        onOpenChange(false);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a member</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs font-medium">Email</span>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              autoFocus
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium">Role</span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={role === "MEMBER" ? "default" : "outline"}
                onClick={() => setRole("MEMBER")}
              >
                Member
              </Button>
              {canAssignAdmin && (
                <Button
                  type="button"
                  variant={role === "ADMIN" ? "default" : "outline"}
                  onClick={() => setRole("ADMIN")}
                >
                  Admin
                </Button>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Members get default per-feature permissions. Refine them after they accept.
            </p>
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting || !email}>
            Send invite
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PermissionsDialog({
  member,
  workspaceId,
  onClose,
  onSaved,
}: {
  member: Member | null;
  workspaceId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [perms, setPerms] = useState<Record<string, PermissionLevel>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resync when a new member is picked for editing.
    if (member) setPerms({ ...(member.permissions ?? {}) });
  }, [member]);

  async function save() {
    if (!member) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/members/${member.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ permissions: perms }),
      });
      if (res.ok) {
        onSaved();
        onClose();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={member !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Permissions — {member?.name}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto divide-y">
          {FEATURES.map((f) => (
            <div key={f} className="flex items-center justify-between py-2 text-sm">
              <span className="capitalize">{f.replace(/_/g, " ")}</span>
              <select
                className="rounded border border-input bg-background px-2 py-1 text-sm"
                value={(perms[f] ?? "hidden") as string}
                onChange={(e) =>
                  setPerms((p) => ({ ...p, [f]: e.target.value as PermissionLevel }))
                }
              >
                {LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          <strong>hidden</strong> = section not visible. <strong>own</strong> = read/write their
          own and records shared with them. <strong>view</strong> = read everything.{" "}
          <strong>full</strong> = full read/write.
        </p>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            Save permissions
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
