"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import useSWR, { mutate as globalMutate } from "swr";
import { toast } from "sonner";
import { Plus, FileSignature } from "lucide-react";
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
import { formatINR, formatDate } from "@/lib/utils";

type LeaseRow = {
  id: string;
  direction: "LEASED_OUT" | "LEASED_IN";
  amount: number;
  frequency: "ONE_TIME" | "YEARLY" | "CUSTOM_MONTHS";
  customMonths: number | null;
  startDate: string;
  endDate: string;
  active: boolean;
  lessor: { id: string | null; name: string } | null;
  lessee: { id: string | null; name: string } | null;
  assetType: "CROP_BATCH" | "LIVESTOCK_BATCH";
  cropBatch: { id: string; name: string; crop: { id: string; name: string } } | null;
  livestockBatch: { id: string; name: string; livestock: { id: string; name: string } } | null;
  totals: {
    upcoming: number;
    confirmed: number;
    totalInstallments: number;
    paid: number;
    outstanding: number;
  };
};

type FamilyMember = { id: string; name: string };
type CropBatch = { id: string; name: string; crop: { id: string; name: string } };
type LivestockBatch = { id: string; name: string; livestock: { id: string; name: string } };

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function LeasesPage() {
  const { data, isLoading } = useSWR<{ leases: LeaseRow[] }>("/api/leases", fetcher);
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Leases</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Lease out or in a crop batch or livestock batch. Payments are scheduled on create;
            confirm each one as it comes in.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" /> New lease
        </Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {(data?.leases ?? []).map((l) => (
          <Link
            key={l.id}
            href={`/leases/${l.id}`}
            className="rounded-xl border bg-card p-5 hover:bg-accent/40 transition"
          >
            <div className="flex items-start gap-3">
              <FileSignature className="h-5 w-5 mt-0.5 text-primary shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold truncate">
                    {l.direction === "LEASED_OUT" ? "Out" : "In"}:{" "}
                    {l.assetType === "CROP_BATCH"
                      ? `${l.cropBatch?.crop.name} / ${l.cropBatch?.name}`
                      : `${l.livestockBatch?.livestock.name} / ${l.livestockBatch?.name}`}
                  </span>
                  <span
                    className={`text-[10px] uppercase tracking-widest rounded px-1.5 py-0.5 ${l.direction === "LEASED_OUT" ? "bg-accent text-primary" : "bg-muted text-muted-foreground"}`}
                  >
                    {l.direction === "LEASED_OUT" ? "OUT" : "IN"}
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground truncate">
                  {l.direction === "LEASED_OUT"
                    ? `To ${l.lessee?.name ?? "—"}`
                    : `From ${l.lessor?.name ?? "—"}`}
                  {" · "}
                  {l.frequency === "CUSTOM_MONTHS"
                    ? `every ${l.customMonths}mo`
                    : l.frequency.replace("_", " ").toLowerCase()}
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  {formatDate(l.startDate)} → {formatDate(l.endDate)}
                </div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
              <div>
                <div className="text-muted-foreground">Total</div>
                <div className="font-medium">{formatINR(l.amount)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Paid</div>
                <div className="font-medium">{formatINR(l.totals.paid)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Upcoming</div>
                <div className="font-medium">
                  {l.totals.upcoming} · {formatINR(l.totals.outstanding)}
                </div>
              </div>
            </div>
          </Link>
        ))}
        {(data?.leases ?? []).length === 0 && !isLoading && (
          <div className="col-span-full rounded-xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
            No leases yet. Lease out a crop batch or livestock batch and the payment schedule is
            created automatically.
          </div>
        )}
      </div>

      <CreateLeaseDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

function CreateLeaseDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const { data: familyData } = useSWR<{ members: FamilyMember[] }>("/api/family", fetcher);
  const { data: cropBatchesData } = useSWR<{ batches: CropBatch[] }>(
    "/api/crop-batches?active=true",
    fetcher
  );
  const { data: livestockBatchesData } = useSWR<{ batches: LivestockBatch[] }>(
    "/api/livestock-batches?active=true",
    fetcher
  );
  const family = familyData?.members ?? [];
  const cropBatches = cropBatchesData?.batches ?? [];
  const livestockBatches = livestockBatchesData?.batches ?? [];

  const [direction, setDirection] = useState<"LEASED_OUT" | "LEASED_IN">("LEASED_OUT");
  const [assetType, setAssetType] = useState<"CROP_BATCH" | "LIVESTOCK_BATCH">("CROP_BATCH");
  const [cropBatchId, setCropBatchId] = useState("");
  const [livestockBatchId, setLivestockBatchId] = useState("");
  const [counterpartyMode, setCounterpartyMode] = useState<"member" | "external">("external");
  const [memberId, setMemberId] = useState("");
  const [externalName, setExternalName] = useState("");
  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState<"ONE_TIME" | "YEARLY" | "CUSTOM_MONTHS">("YEARLY");
  const [customMonths, setCustomMonths] = useState("");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- reset on open */
    setDirection("LEASED_OUT");
    setAssetType("CROP_BATCH");
    setCropBatchId("");
    setLivestockBatchId("");
    setCounterpartyMode("external");
    setMemberId("");
    setExternalName("");
    setAmount("");
    setFrequency("YEARLY");
    setCustomMonths("");
    setStartDate(today);
    setEndDate("");
    setNotes("");
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, today]);

  async function submit() {
    setError(null);
    const amt = Number(amount);
    if (!amt || amt <= 0) return setError("Enter an amount");
    if (!endDate) return setError("Pick an end date");
    if (assetType === "CROP_BATCH" && !cropBatchId) return setError("Pick a crop batch");
    if (assetType === "LIVESTOCK_BATCH" && !livestockBatchId)
      return setError("Pick a livestock batch");
    if (frequency === "CUSTOM_MONTHS" && (!customMonths || Number(customMonths) <= 0))
      return setError("Enter custom months");
    if (counterpartyMode === "external" && !externalName.trim())
      return setError("Enter the counterparty's name");
    if (counterpartyMode === "member" && !memberId) return setError("Pick a family member");

    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        direction,
        assetType,
        cropBatchId: assetType === "CROP_BATCH" ? cropBatchId : null,
        livestockBatchId: assetType === "LIVESTOCK_BATCH" ? livestockBatchId : null,
        amount: amt,
        frequency,
        customMonths: frequency === "CUSTOM_MONTHS" ? Number(customMonths) : null,
        startDate,
        endDate,
        notes: notes.trim() || undefined,
      };
      // Counterparty: the lessor is the owner of the asset; the lessee is who takes it.
      if (direction === "LEASED_OUT") {
        if (counterpartyMode === "member") payload.lesseeMemberId = memberId;
        else payload.lesseeName = externalName.trim();
      } else {
        if (counterpartyMode === "member") payload.lessorMemberId = memberId;
        else payload.lessorName = externalName.trim();
      }

      const res = await fetch("/api/leases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Failed");
        return;
      }
      toast.success(`Lease created · ${body.scheduleCount} payment(s) scheduled`);
      globalMutate("/api/leases");
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>New lease</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            <Button
              type="button"
              variant={direction === "LEASED_OUT" ? "default" : "outline"}
              onClick={() => setDirection("LEASED_OUT")}
            >
              Lease out
            </Button>
            <Button
              type="button"
              variant={direction === "LEASED_IN" ? "default" : "outline"}
              onClick={() => setDirection("LEASED_IN")}
            >
              Lease in
            </Button>
          </div>

          <div>
            <span className="text-xs font-medium block mb-2">Asset</span>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={assetType === "CROP_BATCH" ? "default" : "outline"}
                onClick={() => setAssetType("CROP_BATCH")}
              >
                Crop batch
              </Button>
              <Button
                type="button"
                size="sm"
                variant={assetType === "LIVESTOCK_BATCH" ? "default" : "outline"}
                onClick={() => setAssetType("LIVESTOCK_BATCH")}
              >
                Livestock batch
              </Button>
            </div>
            {assetType === "CROP_BATCH" ? (
              <select
                className="w-full rounded border border-input bg-background px-2 py-2 text-sm mt-2"
                value={cropBatchId}
                onChange={(e) => setCropBatchId(e.target.value)}
              >
                <option value="">— pick crop batch —</option>
                {cropBatches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.crop.name} · {b.name}
                  </option>
                ))}
              </select>
            ) : (
              <select
                className="w-full rounded border border-input bg-background px-2 py-2 text-sm mt-2"
                value={livestockBatchId}
                onChange={(e) => setLivestockBatchId(e.target.value)}
              >
                <option value="">— pick livestock batch —</option>
                {livestockBatches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.livestock.name} · {b.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <span className="text-xs font-medium block mb-2">
              {direction === "LEASED_OUT" ? "Lessee" : "Lessor"}
            </span>
            <div className="flex gap-2 mb-2">
              <Button
                type="button"
                size="sm"
                variant={counterpartyMode === "member" ? "default" : "outline"}
                onClick={() => setCounterpartyMode("member")}
              >
                Family member
              </Button>
              <Button
                type="button"
                size="sm"
                variant={counterpartyMode === "external" ? "default" : "outline"}
                onClick={() => setCounterpartyMode("external")}
              >
                External
              </Button>
            </div>
            {counterpartyMode === "member" ? (
              <select
                className="w-full rounded border border-input bg-background px-2 py-2 text-sm"
                value={memberId}
                onChange={(e) => setMemberId(e.target.value)}
              >
                <option value="">— pick member —</option>
                {family.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                value={externalName}
                onChange={(e) => setExternalName(e.target.value)}
                placeholder="Name"
                maxLength={120}
              />
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium">Total lease amount (₹)</span>
              <AmountInput value={amount} onChange={setAmount}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium">Frequency</span>
              <select
                className="w-full rounded border border-input bg-background px-2 py-2 text-sm mt-1"
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as typeof frequency)}
              >
                <option value="ONE_TIME">One-time</option>
                <option value="YEARLY">Yearly</option>
                <option value="CUSTOM_MONTHS">Every N months</option>
              </select>
            </label>
          </div>

          {frequency === "CUSTOM_MONTHS" && (
            <label className="block">
              <span className="text-xs font-medium">Every N months</span>
              <Input
                type="number"
                min={1}
                value={customMonths}
                onChange={(e) => setCustomMonths(e.target.value)}
                placeholder="e.g. 6"
              />
            </label>
          )}

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium">Start date</span>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </label>
            <label className="block">
              <span className="text-xs font-medium">End date</span>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
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
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "Creating…" : "Create lease"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
