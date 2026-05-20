"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { Pencil, Plus, Trash2, Users, Wallet, CheckCircle2 } from "lucide-react";
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
import { formatINR } from "@/lib/utils";
import { fetcher } from "@/lib/swr-fetcher";

type Contact = {
  id: string;
  name: string;
  relationship: string | null;
  dob: string | null;
  notes: string | null;
  active: boolean;
  linkedUser: { id: string; email: string; name: string } | null;
  totals: { outstanding: number; youOwe: number; settled: number };
};


export default function ContactsPage() {
  const { data, isLoading } = useSWR<{ members: Contact[] }>("/api/contacts", fetcher);
  const [editOpen, setEditOpen] = useState<Contact | "new" | null>(null);

  const members = data?.members ?? [];
  const activeMembers = members.filter((m) => m.active);
  // Direction-aware totals. "Outstanding" historically only meant
  // "they owe me"; we now separately surface "you owe them" so the
  // paidByContact flow doesn't get accounted in the wrong column.
  const totalTheyOweMe = activeMembers.reduce(
    (s, m) => s + m.totals.outstanding,
    0,
  );
  const totalIOweThem = activeMembers.reduce(
    (s, m) => s + m.totals.youOwe,
    0,
  );
  const totalSettled = members.reduce((s, m) => s + m.totals.settled, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Family, friends, neighbours — anyone whose finances you track. Tap a row to see their
            ledger: recoverable charges from expenses tagged to them, plus settlements.
          </p>
        </div>
        <Button onClick={() => setEditOpen("new")} className="gap-2">
          <Plus className="h-4 w-4" /> New
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <StatCard
          label="Active contacts"
          value={String(activeMembers.length)}
          icon={<Users className="h-4 w-4" />}
        />
        <StatCard
          label="They owe you"
          value={formatINR(totalTheyOweMe)}
          icon={<Wallet className="h-4 w-4" />}
          highlight={totalTheyOweMe > 0}
        />
        <StatCard
          label="You owe them"
          value={formatINR(totalIOweThem)}
          icon={<Wallet className="h-4 w-4" />}
          highlight={totalIOweThem > 0}
          tone="negative"
        />
        <StatCard
          label="Settled to date"
          value={formatINR(totalSettled)}
          icon={<CheckCircle2 className="h-4 w-4" />}
        />
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      <div className="rounded-lg border bg-card divide-y">
        {members.map((m) => (
          <MemberRow key={m.id} member={m} onEdit={() => setEditOpen(m)} />
        ))}
        {members.length === 0 && !isLoading && (
          <div className="px-5 py-6 text-sm text-muted-foreground text-center">
            No contacts yet. Add family, friends, neighbours, or anyone else whose finances you
            track.
          </div>
        )}
      </div>

      <ContactDialog
        member={editOpen === "new" ? null : (editOpen as Contact | null)}
        open={editOpen !== null}
        onClose={() => setEditOpen(null)}
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  highlight,
  tone = "default",
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  highlight?: boolean;
  tone?: "default" | "negative";
}) {
  const highlightClass =
    highlight && tone === "negative"
      ? "border-amber-500/40 bg-amber-500/5"
      : highlight
        ? "border-primary/40 bg-primary/5"
        : "";
  return (
    <div className={"rounded-lg border bg-card p-4 " + highlightClass}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div
        className={`mt-1 text-xl font-semibold tabular-nums ${
          tone === "negative" && Number(value.replace(/[^\d]/g, "")) > 0
            ? "text-amber-700 dark:text-amber-400"
            : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function MemberRow({
  member,
  onEdit,
}: {
  member: Contact;
  onEdit: () => void;
}) {
  return (
    <div className="flex items-center gap-3 px-5 py-3">
      <Link
        href={`/contacts/${member.id}`}
        className="flex flex-1 min-w-0 items-center gap-3 hover:bg-accent/40 -mx-5 px-5 py-1 rounded-md transition"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium truncate">{member.name}</span>
            {!member.active && (
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                archived
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {member.relationship ? member.relationship : "—"}
            {member.linkedUser ? ` · linked: ${member.linkedUser.email}` : ""}
          </div>
        </div>
        {member.active && (
          <div className="text-right">
            {member.totals.outstanding > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  They owe you
                </div>
                <div className="text-sm font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                  {formatINR(member.totals.outstanding)}
                </div>
              </div>
            )}
            {member.totals.youOwe > 0 && (
              <div
                className={
                  member.totals.outstanding > 0 ? "mt-1" : ""
                }
              >
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  You owe
                </div>
                <div className="text-sm font-semibold tabular-nums text-amber-700 dark:text-amber-400">
                  {formatINR(member.totals.youOwe)}
                </div>
              </div>
            )}
            {member.totals.outstanding === 0 &&
              member.totals.youOwe === 0 && (
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Settled
                </div>
              )}
          </div>
        )}
      </Link>
      <Button variant="ghost" size="icon" onClick={onEdit} aria-label="Edit">
        <Pencil className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={async () => {
          if (!confirm(`Delete ${member.name}?`)) return;
          await fetch(`/api/contacts/${member.id}`, { method: "DELETE" });
          globalMutate("/api/contacts");
        }}
        aria-label="Delete"
      >
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </div>
  );
}

function ContactDialog({
  member,
  open,
  onClose,
}: {
  member: Contact | null;
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
      const res = await fetch(member ? `/api/contacts/${member.id}` : "/api/contacts", {
        method: member ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) setError(body.error ?? "Failed");
      else {
        globalMutate("/api/contacts");
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
          <DialogTitle>{member ? "Edit contact" : "New contact"}</DialogTitle>
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
              placeholder="e.g. Spouse, Son, Friend, Neighbour"
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
