"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR, { mutate as globalMutate } from "swr";
import { Plus, MoreHorizontal } from "lucide-react";
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
import { mutateBalances } from "@/lib/mutate-balances";
import { formatDate } from "@/lib/utils";

type Batch = {
  id: string;
  name: string;
  startDate: string;
  endDate: string | null;
  expectedCycleDays: number | null;
  initialCount: number;
  currentCount: number;
  notes: string | null;
  active: boolean;
  livestock: { id: string; name: string };
  land: { id: string; name: string } | null;
};

type Account = { id: string; name: string; kind: string };

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function LivestockDetailPage() {
  const params = useParams<{ id: string }>();
  const livestockId = params?.id;
  const { data: livestockList } = useSWR<{ livestock: { id: string; name: string }[] }>(
    "/api/livestock",
    fetcher
  );
  const { data: batchesData } = useSWR<{ batches: Batch[] }>(
    livestockId ? `/api/livestock-batches?livestockId=${livestockId}&active=false` : null,
    fetcher
  );
  const [createBatchOpen, setCreateBatchOpen] = useState(false);
  const [actionBatch, setActionBatch] = useState<{ batch: Batch; tab: "event" | "feed" | "vaccination" } | null>(null);

  const livestock = (livestockList?.livestock ?? []).find((l) => l.id === livestockId);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/livestock" className="text-xs text-muted-foreground">
          ← Livestock
        </Link>
        <div className="mt-1 flex items-start justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{livestock?.name ?? "…"}</h1>
          <Button onClick={() => setCreateBatchOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" /> New batch
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        {(batchesData?.batches ?? []).map((b) => (
          <div key={b.id} className="rounded-lg border bg-card p-5">
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold truncate">{b.name}</span>
                  {!b.active && (
                    <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                      closed
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  Started {formatDate(b.startDate)}
                  {b.expectedCycleDays ? ` · ~${b.expectedCycleDays}d cycle` : ""}
                  {b.land ? ` · ${b.land.name}` : ""}
                </div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-semibold leading-none">{b.currentCount}</div>
                <div className="text-[10px] text-muted-foreground">
                  of {b.initialCount} initial
                </div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setActionBatch({ batch: b, tab: "event" })}
              >
                Record event
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setActionBatch({ batch: b, tab: "feed" })}
              >
                Log feed
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setActionBatch({ batch: b, tab: "vaccination" })}
              >
                Vaccination
              </Button>
              <Link
                href={`/livestock/${livestockId}/batches/${b.id}`}
                className="ml-auto text-xs text-muted-foreground underline self-end"
              >
                <MoreHorizontal className="inline h-3 w-3" /> details
              </Link>
            </div>
          </div>
        ))}
        {(batchesData?.batches ?? []).length === 0 && (
          <div className="rounded-lg border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
            No batches yet. Add the first batch to start counting heads.
          </div>
        )}
      </div>

      <CreateBatchDialog
        livestockId={livestockId ?? ""}
        open={createBatchOpen}
        onClose={() => setCreateBatchOpen(false)}
      />
      <BatchActionDialog
        batchAction={actionBatch}
        onClose={() => setActionBatch(null)}
      />
    </div>
  );
}

function CreateBatchDialog({
  livestockId,
  open,
  onClose,
}: {
  livestockId: string;
  open: boolean;
  onClose: () => void;
}) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState(today);
  const [initialCount, setInitialCount] = useState("0");
  const [expectedCycleDays, setExpectedCycleDays] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- reset on open */
    setName("");
    setStartDate(today);
    setInitialCount("0");
    setExpectedCycleDays("");
    setNotes("");
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, today]);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/livestock-batches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          livestockId,
          name,
          startDate,
          initialCount: Number(initialCount) || 0,
          expectedCycleDays: expectedCycleDays ? Number(expectedCycleDays) : null,
          notes: notes.trim() || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) setError(body.error ?? "Failed");
      else {
        globalMutate(`/api/livestock-batches?livestockId=${livestockId}&active=false`);
        globalMutate("/api/livestock");
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
          <DialogTitle>New batch</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs font-medium">Name</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={80} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium">Start date</span>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </label>
            <label className="block">
              <span className="text-xs font-medium">Initial count</span>
              <Input
                type="number"
                min={0}
                value={initialCount}
                onChange={(e) => setInitialCount(e.target.value)}
              />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium">Expected cycle (days)</span>
            <Input
              type="number"
              min={1}
              value={expectedCycleDays}
              onChange={(e) => setExpectedCycleDays(e.target.value)}
            />
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
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BatchActionDialog({
  batchAction,
  onClose,
}: {
  batchAction: { batch: Batch; tab: "event" | "feed" | "vaccination" } | null;
  onClose: () => void;
}) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const { data: accountsData } = useSWR<{ accounts: Account[] }>("/api/accounts", fetcher);
  const accounts = (accountsData?.accounts ?? []).filter((a) => a.kind !== "CARD");

  // Event state
  const [eventType, setEventType] = useState<"PURCHASE" | "BIRTH" | "DEATH" | "SALE">("BIRTH");
  const [count, setCount] = useState("1");
  const [unitValue, setUnitValue] = useState("");
  // Feed state
  const [feedAmount, setFeedAmount] = useState("");
  const [feedQuantity, setFeedQuantity] = useState("");
  const [feedUnit, setFeedUnit] = useState("");
  // Vaccination state
  const [vaccine, setVaccine] = useState("");
  const [nextDueDate, setNextDueDate] = useState("");
  const [vaccinationCost, setVaccinationCost] = useState("");
  // Common
  const [date, setDate] = useState(today);
  const [accountId, setAccountId] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!batchAction) return;
    /* eslint-disable react-hooks/set-state-in-effect -- reset on open */
    setEventType("BIRTH");
    setCount("1");
    setUnitValue("");
    setFeedAmount("");
    setFeedQuantity("");
    setFeedUnit("");
    setVaccine("");
    setNextDueDate("");
    setVaccinationCost("");
    setDate(today);
    setAccountId("");
    setNotes("");
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [batchAction, today]);

  if (!batchAction) return null;
  const { batch, tab } = batchAction;

  const isFinancial =
    (tab === "event" && (eventType === "SALE" || eventType === "PURCHASE")) ||
    tab === "feed" ||
    (tab === "vaccination" && Number(vaccinationCost) > 0);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      let url = "";
      let payload: Record<string, unknown> = {};
      if (tab === "event") {
        url = `/api/livestock-batches/${batch.id}/events`;
        payload = {
          eventType,
          date,
          count: Number(count) || 0,
          unitValue: unitValue ? Number(unitValue) : null,
          notes: notes.trim() || undefined,
          accountId: accountId || undefined,
        };
      } else if (tab === "feed") {
        url = `/api/livestock-batches/${batch.id}/feed`;
        payload = {
          date,
          amount: Number(feedAmount) || 0,
          quantity: feedQuantity ? Number(feedQuantity) : null,
          unit: feedUnit || undefined,
          notes: notes.trim() || undefined,
          accountId: accountId || undefined,
        };
      } else {
        url = `/api/livestock-batches/${batch.id}/vaccination`;
        payload = {
          vaccine,
          date,
          nextDueDate: nextDueDate || null,
          cost: vaccinationCost ? Number(vaccinationCost) : null,
          notes: notes.trim() || undefined,
          accountId: accountId || undefined,
        };
      }
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) setError(body.error ?? "Failed");
      else {
        globalMutate(`/api/livestock-batches?livestockId=${batch.livestock.id}&active=false`);
        globalMutate("/api/livestock");
        await mutateBalances();
        onClose();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={batchAction !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {tab === "event"
              ? `Event — ${batch.name}`
              : tab === "feed"
                ? `Feed log — ${batch.name}`
                : `Vaccination — ${batch.name}`}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {tab === "event" && (
            <>
              <div className="flex flex-wrap gap-2">
                {(["BIRTH", "DEATH", "SALE", "PURCHASE"] as const).map((e) => (
                  <Button
                    key={e}
                    type="button"
                    size="sm"
                    variant={eventType === e ? "default" : "outline"}
                    onClick={() => setEventType(e)}
                  >
                    {e}
                  </Button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-medium">Count</span>
                  <Input type="number" min={1} value={count} onChange={(e) => setCount(e.target.value)} />
                </label>
                <label className="block">
                  <span className="text-xs font-medium">Date</span>
                  <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </label>
              </div>
              {(eventType === "SALE" || eventType === "PURCHASE") && (
                <label className="block">
                  <span className="text-xs font-medium">Unit value (₹)</span>
                  <AmountInput value={unitValue} onChange={setUnitValue}
                    placeholder="Per animal"
                  />
                </label>
              )}
              <p className="text-xs text-muted-foreground">
                Current count: {batch.currentCount}. Birth/Purchase add; Death/Sale subtract.
              </p>
            </>
          )}
          {tab === "feed" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-medium">Cost (₹)</span>
                  <AmountInput value={feedAmount} onChange={setFeedAmount}
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium">Date</span>
                  <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-medium">Quantity (optional)</span>
                  <AmountInput value={feedQuantity} onChange={setFeedQuantity}
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium">Unit</span>
                  <Input
                    value={feedUnit}
                    onChange={(e) => setFeedUnit(e.target.value)}
                    placeholder="kg, bag, sack…"
                    maxLength={20}
                  />
                </label>
              </div>
            </>
          )}
          {tab === "vaccination" && (
            <>
              <label className="block">
                <span className="text-xs font-medium">Vaccine</span>
                <Input value={vaccine} onChange={(e) => setVaccine(e.target.value)} maxLength={80} />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-medium">Date</span>
                  <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </label>
                <label className="block">
                  <span className="text-xs font-medium">Next due date</span>
                  <Input
                    type="date"
                    value={nextDueDate}
                    onChange={(e) => setNextDueDate(e.target.value)}
                  />
                </label>
              </div>
              <label className="block">
                <span className="text-xs font-medium">Cost (₹, optional)</span>
                <AmountInput value={vaccinationCost} onChange={setVaccinationCost}
                />
              </label>
            </>
          )}

          {isFinancial && (
            <label className="block">
              <span className="text-xs font-medium">Pay from / receive into</span>
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
          )}

          <label className="block">
            <span className="text-xs font-medium">Notes</span>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
          </label>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={submitting}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
