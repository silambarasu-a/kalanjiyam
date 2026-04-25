"use client";
import { toast } from "sonner";

import { useEffect, useState } from "react";
import Link from "next/link";
import useSWR, { mutate as globalMutate } from "swr";
import { HardHat, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AmountInput } from "@/components/ui/amount-input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatINR } from "@/lib/utils";
import { MoneyValue, ToneBadge } from "@/components/ui/money-tone";

type Cadence = "AS_NEEDED" | "WEEKLY" | "MONTHLY" | "CUSTOM";

type Worker = {
  id: string;
  name: string;
  phone: string | null;
  dailyRate: number | null;
  settlementCadence: Cadence;
  customCadenceDays: number | null;
  active: boolean;
  balance: number;
  daysWorked: number;
};

const CADENCE_LABELS: Record<Cadence, string> = {
  AS_NEEDED: "Pay as needed",
  WEEKLY: "Weekly",
  MONTHLY: "Monthly",
  CUSTOM: "Custom",
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function WorkersPage() {
  const { data, isLoading } = useSWR<{ workers: Worker[] }>("/api/workers", fetcher);
  const [editOpen, setEditOpen] = useState<Worker | "new" | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Workers</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Day-labour roster. Each worker has a daily rate, attendance log, and running owed
            balance (earnings minus non-bonus payments).
          </p>
        </div>
        <Button onClick={() => setEditOpen("new")} className="gap-2">
          <Plus className="h-4 w-4" /> New worker
        </Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {(data?.workers ?? []).map((w) => (
          <div key={w.id} className="rounded-xl border bg-card p-5 flex items-start gap-3">
            <HardHat className="h-5 w-5 mt-0.5 text-primary shrink-0" />
            <Link href={`/workers/${w.id}`} className="min-w-0 flex-1">
              <h3 className="font-semibold truncate">{w.name}</h3>
              <div className="mt-0.5 text-xs text-muted-foreground truncate">
                {w.phone ? `${w.phone} · ` : ""}
                {w.dailyRate != null ? `₹${w.dailyRate}/day · ` : ""}
                {CADENCE_LABELS[w.settlementCadence]}
                {w.settlementCadence === "CUSTOM" && w.customCadenceDays
                  ? ` (${w.customCadenceDays}d)`
                  : ""}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <MoneyValue
                  tone={
                    w.balance > 0 ? "owed_in" : w.balance < 0 ? "advance" : "settled"
                  }
                  value={`${w.balance > 0 ? "+" : w.balance < 0 ? "−" : ""}${formatINR(Math.abs(w.balance))}`}
                  className="text-lg font-semibold"
                />
                <ToneBadge
                  tone={
                    w.balance > 0 ? "owed_in" : w.balance < 0 ? "advance" : "settled"
                  }
                  label={
                    w.balance > 0 ? "Owed" : w.balance < 0 ? "Advance" : "Settled"
                  }
                />
                <span className="text-xs text-muted-foreground">{w.daysWorked}d</span>
              </div>
            </Link>
            <Button variant="ghost" size="icon" onClick={() => setEditOpen(w)} aria-label="Edit">
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={async () => {
                if (!confirm(`Delete ${w.name}?`)) return;
                const res = await fetch(`/api/workers/${w.id}`, { method: "DELETE" });
                if (!res.ok) {
                  const body = await res.json();
                  toast.error(body.error ?? "Failed");
                }
                globalMutate("/api/workers");
              }}
              aria-label="Delete"
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        ))}
        {(data?.workers ?? []).length === 0 && !isLoading && (
          <div className="col-span-full rounded-xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
            No workers yet. Add your regulars — those who come for a month, a week, or a day.
          </div>
        )}
      </div>

      <WorkerDialog
        worker={editOpen === "new" ? null : (editOpen as Worker | null)}
        open={editOpen !== null}
        onClose={() => setEditOpen(null)}
      />
    </div>
  );
}

function WorkerDialog({
  worker,
  open,
  onClose,
}: {
  worker: Worker | null;
  open: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [dailyRate, setDailyRate] = useState("");
  const [cadence, setCadence] = useState<Cadence>("AS_NEEDED");
  const [customDays, setCustomDays] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- reset on open */
    setName(worker?.name ?? "");
    setPhone(worker?.phone ?? "");
    setDailyRate(worker?.dailyRate != null ? String(worker.dailyRate) : "");
    setCadence(worker?.settlementCadence ?? "AS_NEEDED");
    setCustomDays(
      worker?.customCadenceDays != null ? String(worker.customCadenceDays) : ""
    );
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, worker]);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const payload = {
        name,
        phone: phone.trim() || undefined,
        dailyRate: dailyRate ? Number(dailyRate) : null,
        settlementCadence: cadence,
        customCadenceDays: cadence === "CUSTOM" && customDays ? Number(customDays) : null,
      };
      const res = await fetch(worker ? `/api/workers/${worker.id}` : "/api/workers", {
        method: worker ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) setError(body.error ?? "Failed");
      else {
        globalMutate("/api/workers");
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
          <DialogTitle>{worker ? "Edit worker" : "New worker"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs font-medium">Name</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={80} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium">Phone</span>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} />
            </label>
            <label className="block">
              <span className="text-xs font-medium">Daily rate (₹)</span>
              <AmountInput value={dailyRate} onChange={setDailyRate}
              />
            </label>
          </div>
          <div>
            <span className="text-xs font-medium block mb-1">Settlement cadence</span>
            <p className="text-xs text-muted-foreground mb-2">
              Pick a cadence only if you settle on a fixed schedule. Otherwise leave it as
              <strong className="text-foreground"> Pay as needed</strong> and pay when you choose.
            </p>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  { v: "AS_NEEDED", l: "Pay as needed" },
                  { v: "WEEKLY", l: "Weekly" },
                  { v: "MONTHLY", l: "Monthly" },
                  { v: "CUSTOM", l: "Custom" },
                ] as { v: Cadence; l: string }[]
              ).map((opt) => (
                <Button
                  key={opt.v}
                  type="button"
                  size="sm"
                  variant={cadence === opt.v ? "default" : "outline"}
                  onClick={() => setCadence(opt.v)}
                >
                  {opt.l}
                </Button>
              ))}
            </div>
            {cadence === "CUSTOM" && (
              <Input
                className="mt-2"
                type="number"
                min={1}
                placeholder="Days (e.g. 10)"
                value={customDays}
                onChange={(e) => setCustomDays(e.target.value)}
              />
            )}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={submitting || !name.trim()}>
            {worker ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
