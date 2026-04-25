"use client";

import { useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { useSession } from "next-auth/react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

type WorkspaceRow = {
  id: string;
  name: string;
  role: "OWNER" | "ADMIN" | "MEMBER" | "SUPER_ADMIN";
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function WorkspacesPage() {
  const { data: session, update } = useSession();
  const { data, isLoading } = useSWR<{ workspaces: WorkspaceRow[]; cap: number }>(
    "/api/workspaces",
    fetcher
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const workspaces = data?.workspaces ?? [];
  const cap = data?.cap ?? 3;
  const activeId = session?.user.activeWorkspaceId;

  async function createWorkspace() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: newName }),
      });
      const body = await res.json();
      if (!res.ok) setError(body.error ?? "Failed");
      else {
        await globalMutate("/api/workspaces");
        setCreateOpen(false);
        setNewName("");
      }
    } finally {
      setBusy(false);
    }
  }

  async function rename(id: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/workspaces/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: renameText }),
      });
      if (res.ok) {
        await globalMutate("/api/workspaces");
        setRenameId(null);
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/workspaces/${id}`, { method: "DELETE" });
      if (res.ok) {
        await globalMutate("/api/workspaces");
        if (id === activeId) {
          await update();
          window.location.href = "/dashboard";
          return;
        }
        setDeleteId(null);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Workspaces</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            You belong to {workspaces.length} of {cap} allowed workspaces.
          </p>
        </div>
        <Button
          disabled={workspaces.length >= cap}
          onClick={() => setCreateOpen(true)}
          className="gap-2"
        >
          <Plus className="h-4 w-4" /> New workspace
        </Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {workspaces.map((w) => (
          <div key={w.id} className="rounded-lg border bg-card p-5 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="truncate font-semibold">{w.name}</h3>
                {w.id === activeId && (
                  <span className="text-[10px] uppercase tracking-widest text-[var(--brand-orange)]">
                    active
                  </span>
                )}
              </div>
              <div className="mt-1 text-xs uppercase tracking-wider text-muted-foreground">
                {w.role}
              </div>
            </div>
            <div className="flex gap-1">
              {(w.role === "OWNER" || w.role === "ADMIN") && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setRenameId(w.id);
                    setRenameText(w.name);
                  }}
                  aria-label="Rename"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
              )}
              {w.role === "OWNER" && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setDeleteId(w.id)}
                  aria-label="Delete"
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New workspace</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <label className="block">
              <span className="text-xs font-medium">Name</span>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                maxLength={80}
                autoFocus
                placeholder="e.g. Home Farm"
              />
            </label>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={createWorkspace} disabled={busy || !newName.trim()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renameId !== null} onOpenChange={(o) => !o && setRenameId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename workspace</DialogTitle>
          </DialogHeader>
          <Input
            value={renameText}
            onChange={(e) => setRenameText(e.target.value)}
            maxLength={80}
            autoFocus
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenameId(null)}>Cancel</Button>
            <Button onClick={() => renameId && rename(renameId)} disabled={busy || !renameText.trim()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete workspace?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This permanently deletes the workspace and every transaction, account, family member,
            crop, batch, loan, and investment inside it. Members will lose access. This cannot be
            undone.
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteId && remove(deleteId)}
              disabled={busy}
            >
              Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
