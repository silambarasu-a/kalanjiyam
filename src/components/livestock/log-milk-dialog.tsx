"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DateInput } from "@/components/ui/date-input";
import { AmountInput } from "@/components/ui/amount-input";
import { NativeSelect } from "@/components/ui/native-select";
import { DescriptionField } from "@/components/ui/description-field";
import { formatINR, groupAccountOptions } from "@/lib/utils";
import { fetcher } from "@/lib/swr-fetcher";

type Account = {
  id: string;
  name: string;
  kind: string;
  balance: number;
  availableLimit: number | null;
};

const DEFAULT_SESSIONS: { key: string; label: string }[] = [
  { key: "MORNING", label: "Morning" },
  { key: "EVENING", label: "Evening" },
];

/**
 * Logs (or edits) daily milk production for a DAIRY batch. Sessions
 * (morning / evening / etc) sum into `totalLitres`; the user can add
 * or remove sessions without a schema change. If they enter
 * `soldLitres` + a `ratePerLitre`, the API creates a linked INCOME
 * Transaction so the cashflow dashboard stays accurate. Pass `initial`
 * to switch into edit mode — sale fields are locked once a Transaction
 * is linked (PATCH refuses silent re-pricing).
 */
export function LogMilkDialog({
  open,
  onOpenChange,
  batchId,
  animals,
  initial,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batchId: string;
  animals?: { id: string; tagNumber: string; name: string | null }[];
  initial?: {
    id: string;
    animalId: string | null;
    date: string;
    totalLitres: number;
    sessions: unknown;
    fatPct: number | null;
    snfPct: number | null;
    soldLitres: number | null;
    ratePerLitre: number | null;
    transactionId: string | null;
    notes: string | null;
  };
  onSaved: () => void;
}) {
  const isEdit = !!initial;
  const saleLocked = !!initial?.transactionId;
  const { data: accountsRes } = useSWR<{ accounts: Account[] }>(
    open ? "/api/accounts" : null,
    fetcher,
  );
  const accounts = useMemo(
    () => (accountsRes?.accounts ?? []).filter((a) => a.kind !== "CARD"),
    [accountsRes],
  );

  const initialSessions = (() => {
    if (!initial || initial.sessions == null) return null;
    const raw = initial.sessions;
    if (typeof raw !== "object") return null;
    return Object.entries(raw as Record<string, number>).map(([key, n]) => ({
      key,
      litres: typeof n === "number" ? String(n) : String(n),
    }));
  })();
  const [date, setDate] = useState(
    () => initial?.date.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
  );
  const [sessions, setSessions] = useState<{ key: string; litres: string }[]>(
    () =>
      initialSessions && initialSessions.length > 0
        ? initialSessions
        : initial
          ? [{ key: "MORNING", litres: String(initial.totalLitres) }]
          : DEFAULT_SESSIONS.map((s) => ({ key: s.key, litres: "" })),
  );
  const [animalId, setAnimalId] = useState(initial?.animalId ?? "");
  const [fatPct, setFatPct] = useState(
    initial?.fatPct != null ? String(initial.fatPct) : "",
  );
  const [snfPct, setSnfPct] = useState(
    initial?.snfPct != null ? String(initial.snfPct) : "",
  );
  const [soldLitres, setSoldLitres] = useState(
    initial?.soldLitres != null ? String(initial.soldLitres) : "",
  );
  const [ratePerLitre, setRatePerLitre] = useState(
    initial?.ratePerLitre != null ? String(initial.ratePerLitre) : "",
  );
  const [accountId, setAccountId] = useState("");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalLitres = sessions.reduce(
    (sum, s) => sum + (Number(s.litres) || 0),
    0,
  );
  const expectedRevenue =
    Number(soldLitres) > 0 && Number(ratePerLitre) > 0
      ? Number(soldLitres) * Number(ratePerLitre)
      : 0;
  const hasSale = expectedRevenue > 0;

  function setSessionLitres(key: string, litres: string) {
    setSessions((cur) =>
      cur.map((s) => (s.key === key ? { ...s, litres } : s)),
    );
  }
  function addSession() {
    setSessions((cur) => [
      ...cur,
      { key: `SESSION_${cur.length + 1}`, litres: "" },
    ]);
  }
  function removeSession(key: string) {
    setSessions((cur) => cur.filter((s) => s.key !== key));
  }

  async function submit() {
    setError(null);
    if (totalLitres <= 0) return setError("Enter milk in at least one session");
    if (hasSale && !accountId)
      return setError("Pick the account / wallet that receives the sale");
    setSubmitting(true);
    try {
      const sessionMap = sessions.reduce<Record<string, number>>(
        (acc, s) => {
          const n = Number(s.litres);
          if (Number.isFinite(n) && n > 0) acc[s.key] = n;
          return acc;
        },
        {},
      );
      const url = isEdit
        ? `/api/livestock-batches/${batchId}/milk/${initial!.id}`
        : `/api/livestock-batches/${batchId}/milk`;
      const payload = isEdit
        ? {
            animalId: animalId || null,
            date,
            totalLitres,
            sessions: Object.keys(sessionMap).length ? sessionMap : null,
            fatPct: fatPct ? Number(fatPct) : null,
            snfPct: snfPct ? Number(snfPct) : null,
            // Sale fields stay frozen on edit — PATCH refuses silent
            // re-pricing of a linked Transaction.
            notes: notes.trim() || undefined,
          }
        : {
            animalId: animalId || null,
            date,
            totalLitres,
            sessions: Object.keys(sessionMap).length ? sessionMap : null,
            fatPct: fatPct ? Number(fatPct) : null,
            snfPct: snfPct ? Number(snfPct) : null,
            soldLitres: soldLitres ? Number(soldLitres) : null,
            ratePerLitre: ratePerLitre ? Number(ratePerLitre) : null,
            accountId: hasSale ? accountId : null,
            notes: notes.trim() || undefined,
          };
      const res = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Failed to save");
        return;
      }
      onOpenChange(false);
      onSaved();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit milk log" : "Log milk"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Date</Label>
              <DateInput
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            {animals && animals.length > 0 && (
              <div className="space-y-1">
                <Label className="text-xs">
                  Per-cow{" "}
                  <span className="font-normal text-muted-foreground">
                    (optional)
                  </span>
                </Label>
                <NativeSelect
                  value={animalId}
                  onChange={setAnimalId}
                  placeholder="— herd total —"
                  options={[
                    { value: "", label: "— herd total —" },
                    ...animals.map((a) => ({
                      value: a.id,
                      label: a.name
                        ? `#${a.tagNumber} · ${a.name}`
                        : `#${a.tagNumber}`,
                    })),
                  ]}
                  searchable
                />
              </div>
            )}
          </div>

          <div className="space-y-1.5 rounded-xl border bg-muted/20 p-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Sessions (litres)</Label>
              <Button
                size="sm"
                variant="ghost"
                onClick={addSession}
                className="h-6 gap-1 px-1.5 text-[10px]"
              >
                <Plus className="h-3 w-3" /> Session
              </Button>
            </div>
            {sessions.map((s) => (
              <div
                key={s.key}
                className="grid grid-cols-[110px_1fr_auto] items-center gap-2"
              >
                <span className="text-[11px] text-muted-foreground">
                  {s.key
                    .replace("_", " ")
                    .toLowerCase()
                    .replace(/^./, (c) => c.toUpperCase())}
                </span>
                <Input
                  inputMode="decimal"
                  value={s.litres}
                  onChange={(e) =>
                    setSessionLitres(
                      s.key,
                      e.target.value.replace(/[^\d.]/g, "").slice(0, 8),
                    )
                  }
                  placeholder="0.0"
                  className="h-8"
                />
                {sessions.length > 1 && (
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => removeSession(s.key)}
                    className="h-7 w-7"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                )}
              </div>
            ))}
            <div className="flex items-center justify-between border-t pt-2 text-xs">
              <span className="text-muted-foreground">Total today</span>
              <span className="tabular-nums font-medium">
                {totalLitres.toFixed(2)} L
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">
                Fat %{" "}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </Label>
              <Input
                inputMode="decimal"
                value={fatPct}
                onChange={(e) =>
                  setFatPct(e.target.value.replace(/[^\d.]/g, "").slice(0, 5))
                }
                placeholder="4.5"
                className="h-8"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">
                SNF %{" "}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </Label>
              <Input
                inputMode="decimal"
                value={snfPct}
                onChange={(e) =>
                  setSnfPct(e.target.value.replace(/[^\d.]/g, "").slice(0, 5))
                }
                placeholder="8.5"
                className="h-8"
              />
            </div>
          </div>

          <div className="rounded-xl border bg-muted/20 p-3">
            <Label className="text-xs">Sale (optional)</Label>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {saleLocked
                ? "Locked — this log has a linked income transaction. Delete + re-add to change."
                : "Filling both fields creates an INCOME transaction tagged to this batch."}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-[10px]">Sold litres</Label>
                <Input
                  inputMode="decimal"
                  value={soldLitres}
                  onChange={(e) =>
                    setSoldLitres(
                      e.target.value.replace(/[^\d.]/g, "").slice(0, 8),
                    )
                  }
                  placeholder={totalLitres ? totalLitres.toFixed(1) : "0.0"}
                  className="h-8"
                  disabled={saleLocked}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">₹ per litre</Label>
                <AmountInput
                  value={ratePerLitre}
                  onChange={setRatePerLitre}
                  placeholder="40.00"
                  disabled={saleLocked}
                />
              </div>
            </div>
            {hasSale && (
              <>
                <div className="mt-2 flex items-center justify-between rounded-md border bg-background px-3 py-1.5 text-xs">
                  <span className="text-muted-foreground">Revenue</span>
                  <span className="font-medium tabular-nums">
                    {formatINR(expectedRevenue)}
                  </span>
                </div>
                <div className="mt-2 space-y-1">
                  <Label className="text-[10px]">Receive into</Label>
                  <NativeSelect
                    value={accountId}
                    onChange={setAccountId}
                    options={groupAccountOptions(accounts, 0)}
                    searchable
                    placeholder="— pick account —"
                  />
                </div>
              </>
            )}
          </div>

          <DescriptionField
            label="Notes"
            value={notes}
            onChange={setNotes}
            placeholder="Buyer name, route, anything worth recording…"
            maxLength={500}
            rows={2}
          />

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "Saving…" : isEdit ? "Save" : "Log milk"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
