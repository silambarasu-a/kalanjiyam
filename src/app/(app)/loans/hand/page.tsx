"use client";

import { useEffect, useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { toast } from "sonner";
import { Plus, HandCoins, Pencil, Trash2, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LoanForm } from "@/components/loans/loan-form";
import { mutateBalances } from "@/lib/mutate-balances";
import { formatINR } from "@/lib/utils";

type Member = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  active: boolean;
  totalGiven: number;
  totalReceived: number;
  balance: number;
  entryCount: number;
};

type Account = { id: string; name: string; kind: string };

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function HandLoansPage() {
  const { data, isLoading } = useSWR<{ members: Member[] }>(
    "/api/hand-loan-members",
    fetcher
  );
  const [editMember, setEditMember] = useState<Member | "new" | null>(null);
  const [entryMember, setEntryMember] = useState<Member | null>(null);
  const [formalOpen, setFormalOpen] = useState(false);

  const totalsOut = (data?.members ?? []).reduce(
    (s, m) => s + Math.max(0, m.balance),
    0
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Hand loans</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Informal lending between friends and family. Positive balance = they owe you.
            {totalsOut > 0 ? ` · ${formatINR(totalsOut)} out right now` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setFormalOpen(true)}>
            Formal loan
          </Button>
          <Button onClick={() => setEditMember("new")} className="gap-2">
            <Plus className="h-4 w-4" /> New person
          </Button>
        </div>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {(data?.members ?? []).map((m) => (
          <div key={m.id} className="rounded-xl border bg-card p-5 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <HandCoins className="h-4 w-4 text-primary shrink-0" />
                  <h3 className="truncate font-semibold">{m.name}</h3>
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {m.phone ? `${m.phone} · ` : ""}
                  {m.entryCount} entries
                </div>
              </div>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setEditMember(m)}
                  aria-label="Edit"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={async () => {
                    if (!confirm(`Delete ${m.name}?`)) return;
                    const res = await fetch(`/api/hand-loan-members/${m.id}`, {
                      method: "DELETE",
                    });
                    if (!res.ok) {
                      const body = await res.json();
                      alert(body.error ?? "Failed");
                    }
                    globalMutate("/api/hand-loan-members");
                  }}
                  aria-label="Delete"
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Balance</div>
              <div
                className={`text-2xl font-semibold ${
                  m.balance > 0
                    ? "text-primary"
                    : m.balance < 0
                      ? "text-destructive"
                      : "text-muted-foreground"
                }`}
              >
                {m.balance > 0 ? "+" : m.balance < 0 ? "−" : ""}
                {formatINR(Math.abs(m.balance))}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                +{formatINR(m.totalGiven)} given / −{formatINR(m.totalReceived)} received
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="gap-1"
                onClick={() => setEntryMember(m)}
              >
                <ArrowUpRight className="h-3 w-3" /> I gave
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1"
                onClick={() => setEntryMember(m)}
              >
                <ArrowDownLeft className="h-3 w-3" /> I received
              </Button>
            </div>
          </div>
        ))}
        {(data?.members ?? []).length === 0 && !isLoading && (
          <div className="col-span-full rounded-xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
            Add people here to track informal loans given or received.
          </div>
        )}
      </div>

      <MemberDialog
        member={editMember === "new" ? null : (editMember as Member | null)}
        open={editMember !== null}
        onClose={() => setEditMember(null)}
      />
      <EntryDialog
        member={entryMember}
        onClose={() => setEntryMember(null)}
      />
      <Dialog open={formalOpen} onOpenChange={(o) => !o && setFormalOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Formal hand loan</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Formal hand loans behave like bank loans — with interest and an EMI schedule.
          </p>
          <LoanForm
            source="HAND_FORMAL"
            onSaved={() => setFormalOpen(false)}
            onCancel={() => setFormalOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MemberDialog({
  member,
  open,
  onClose,
}: {
  member: Member | null;
  open: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- reset on open */
    setName(member?.name ?? "");
    setEmail(member?.email ?? "");
    setPhone(member?.phone ?? "");
    setNotes("");
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, member]);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const payload = {
        name,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        notes: notes.trim() || undefined,
      };
      const res = await fetch(
        member ? `/api/hand-loan-members/${member.id}` : "/api/hand-loan-members",
        {
          method: member ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const body = await res.json();
      if (!res.ok) setError(body.error ?? "Failed");
      else {
        globalMutate("/api/hand-loan-members");
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
          <DialogTitle>{member ? "Edit person" : "New person"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs font-medium">Name</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={80} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium">Email</span>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label className="block">
              <span className="text-xs font-medium">Phone</span>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium">Notes</span>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting || !name.trim()}>
            {member ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EntryDialog({
  member,
  onClose,
}: {
  member: Member | null;
  onClose: () => void;
}) {
  const { data: accountsData } = useSWR<{ accounts: Account[] }>("/api/accounts", fetcher);
  const accounts = (accountsData?.accounts ?? []).filter((a) => a.kind !== "CARD");

  const today = new Date().toISOString().slice(0, 10);
  const [direction, setDirection] = useState<"GIVEN" | "RECEIVED">("GIVEN");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [accountId, setAccountId] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!member) return;
    /* eslint-disable react-hooks/set-state-in-effect -- reset on open */
    setDirection("GIVEN");
    setAmount("");
    setDate(today);
    setAccountId("");
    setNotes("");
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [member, today]);

  async function submit() {
    if (!member) return;
    setError(null);
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      setError("Enter an amount");
      return;
    }
    if (!accountId) {
      setError("Pick an account");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/hand-loan-entries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          memberId: member.id,
          direction,
          amount: amt,
          date,
          accountId,
          notes: notes.trim() || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) setError(body.error ?? "Failed");
      else {
        toast.success(direction === "GIVEN" ? "Gave" : "Received");
        globalMutate("/api/hand-loan-members");
        await mutateBalances();
        onClose();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={member !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Hand loan entry — {member?.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            <Button
              type="button"
              variant={direction === "GIVEN" ? "default" : "outline"}
              onClick={() => setDirection("GIVEN")}
              className="gap-1.5"
            >
              <ArrowUpRight className="h-4 w-4" /> I gave
            </Button>
            <Button
              type="button"
              variant={direction === "RECEIVED" ? "default" : "outline"}
              onClick={() => setDirection("RECEIVED")}
              className="gap-1.5"
            >
              <ArrowDownLeft className="h-4 w-4" /> I received
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium">Amount (₹)</span>
              <Input
                type="number"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                autoFocus
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium">Date</span>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium">
              {direction === "GIVEN" ? "Paid from" : "Received into"}
            </span>
            <select
              className="w-full rounded border border-input bg-background px-2 py-2 text-sm mt-1"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              <option value="">— pick —</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium">Notes</span>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
