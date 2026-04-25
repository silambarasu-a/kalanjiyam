"use client";

import { useEffect, useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type FamilyMember = {
  id: string;
  name: string;
  relationship: string | null;
  dob: string | null;
  notes: string | null;
  active: boolean;
  linkedUser: { id: string; email: string; name: string } | null;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function FamilyPage() {
  const { data, isLoading } = useSWR<{ members: FamilyMember[] }>("/api/family", fetcher);
  const [editOpen, setEditOpen] = useState<FamilyMember | "new" | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Family members</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            People whose finances you track. Used as beneficiaries on transactions and for the
            Member Ledger.
          </p>
        </div>
        <Button onClick={() => setEditOpen("new")} className="gap-2">
          <Plus className="h-4 w-4" /> New
        </Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      <div className="rounded-lg border bg-card divide-y">
        {(data?.members ?? []).map((m) => (
          <div key={m.id} className="flex items-center gap-3 px-5 py-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium truncate">{m.name}</span>
                {!m.active && (
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    archived
                  </span>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                {m.relationship ? m.relationship : "—"}
                {m.linkedUser ? ` · linked: ${m.linkedUser.email}` : ""}
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={() => setEditOpen(m)} aria-label="Edit">
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={async () => {
                if (!confirm(`Delete ${m.name}?`)) return;
                await fetch(`/api/family/${m.id}`, { method: "DELETE" });
                globalMutate("/api/family");
              }}
              aria-label="Delete"
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        ))}
        {(data?.members ?? []).length === 0 && !isLoading && (
          <div className="px-5 py-6 text-sm text-muted-foreground text-center">
            No family members yet. Add spouse, children, parents, or anyone else whose finances you
            track.
          </div>
        )}
      </div>

      <FamilyDialog
        member={editOpen === "new" ? null : (editOpen as FamilyMember | null)}
        open={editOpen !== null}
        onClose={() => setEditOpen(null)}
      />
    </div>
  );
}

function FamilyDialog({
  member,
  open,
  onClose,
}: {
  member: FamilyMember | null;
  open: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [relationship, setRelationship] = useState("");
  const [notes, setNotes] = useState("");
  const [dob, setDob] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- reset form state on dialog open. */
    setName(member?.name ?? "");
    setRelationship(member?.relationship ?? "");
    setNotes(member?.notes ?? "");
    setDob(member?.dob ? member.dob.slice(0, 10) : "");
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, member]);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const payload = {
        name,
        relationship: relationship.trim() || undefined,
        notes: notes.trim() || undefined,
        dob: dob || undefined,
      };
      const res = await fetch(member ? `/api/family/${member.id}` : "/api/family", {
        method: member ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) setError(body.error ?? "Failed");
      else {
        globalMutate("/api/family");
        onClose();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{member ? "Edit family member" : "New family member"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs font-medium">Name</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={80} />
          </label>
          <label className="block">
            <span className="text-xs font-medium">Relationship</span>
            <Input
              value={relationship}
              onChange={(e) => setRelationship(e.target.value)}
              placeholder="e.g. Spouse, Son, Mother"
              maxLength={40}
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium">
              Date of birth <span className="text-muted-foreground font-normal">(optional)</span>
            </span>
            <DateInput value={dob} onChange={(e) => setDob(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-xs font-medium">Notes</span>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={submitting || !name.trim()}>
            {member ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
