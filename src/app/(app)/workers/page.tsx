"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import useSWR, { mutate as globalMutate } from "swr";
import { HardHat, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatINR } from "@/lib/utils";

type Worker = {
  id: string;
  name: string;
  phone: string | null;
  dailyRate: number | null;
  settlementCadence: "WEEKLY" | "MONTHLY" | "CUSTOM";
  customCadenceDays: number | null;
  active: boolean;
  balance: number;
  daysWorked: number;
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
                {w.settlementCadence}
                {w.settlementCadence === "CUSTOM" && w.customCadenceDays
                  ? ` (${w.customCadenceDays}d)`
                  : ""}
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span
                  className={`text-lg font-semibold ${
                    w.balance > 0
                      ? "text-primary"
                      : w.balance < 0
                        ? "text-destructive"
                        : "text-muted-foreground"
                  }`}
                >
                  {w.balance > 0 ? "+" : w.balance < 0 ? "−" : ""}
                  {formatINR(Math.abs(w.balance))}
                </span>
                <span className="text-xs text-muted-foreground">
                  {w.balance > 0 ? "owed" : w.balance < 0 ? "advance" : "settled"} ·{" "}
                  {w.daysWorked}d
                </span>
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
                  alert(body.error ?? "Failed");
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
  const [cadence, setCadence] = useState<"WEEKLY" | "MONTHLY" | "CUSTOM">("MONTHLY");
  const [customDays, setCustomDays] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- reset on open */
    setName(worker?.name ?? "");
    setPhone(worker?.phone ?? "");
    setDailyRate(worker?.dailyRate != null ? String(worker.dailyRate) : "");
    setCadence(worker?.settlementCadence ?? "MONTHLY");
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
              <Input
                type="number"
                inputMode="decimal"
                value={dailyRate}
                onChange={(e) => setDailyRate(e.target.value)}
              />
            </label>
          </div>
          <div>
            <span className="text-xs font-medium block mb-2">Settlement cadence</span>
            <div className="flex gap-2">
              {(["WEEKLY", "MONTHLY", "CUSTOM"] as const).map((c) => (
                <Button
                  key={c}
                  type="button"
                  size="sm"
                  variant={cadence === c ? "default" : "outline"}
                  onClick={() => setCadence(c)}
                >
                  {c}
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
