"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { Stethoscope } from "lucide-react";
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
import { groupAccountOptions } from "@/lib/utils";
import { fetcher } from "@/lib/swr-fetcher";

type Account = {
  id: string;
  name: string;
  kind: string;
  balance: number;
  availableLimit: number | null;
};

/**
 * Log (or edit) a health / disease incident. Distinct from
 * VaccinationLog — this captures sick birds / sick animals + the
 * treatment given + (optional) cost. Setting a cost auto-creates an
 * EXPENSE Transaction tagged to the batch. Pass `initial` to switch
 * into edit mode — cost is locked once a Transaction is linked.
 */
export function LogHealthDialog({
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
    condition: string;
    treatment: string | null;
    cost: number | null;
    resolved: boolean;
    resolvedAt: string | null;
    transactionId: string | null;
    notes: string | null;
  };
  onSaved: () => void;
}) {
  const isEdit = !!initial;
  const costLocked = !!initial?.transactionId;
  const { data: accountsRes } = useSWR<{ accounts: Account[] }>(
    open ? "/api/accounts" : null,
    fetcher,
  );
  const accounts = useMemo(
    () => (accountsRes?.accounts ?? []).filter((a) => a.kind !== "CARD"),
    [accountsRes],
  );

  const [date, setDate] = useState(
    () => initial?.date.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
  );
  const [condition, setCondition] = useState(initial?.condition ?? "");
  const [treatment, setTreatment] = useState(initial?.treatment ?? "");
  const [animalId, setAnimalId] = useState(initial?.animalId ?? "");
  const [cost, setCost] = useState(
    initial?.cost != null ? String(initial.cost) : "",
  );
  const [accountId, setAccountId] = useState("");
  const [resolved, setResolved] = useState(initial?.resolved ?? false);
  const [resolvedAt, setResolvedAt] = useState(
    initial?.resolvedAt?.slice(0, 10) ?? "",
  );
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasCost = Number(cost) > 0;

  async function submit() {
    setError(null);
    if (!condition.trim()) return setError("Condition is required");
    if (hasCost && !accountId)
      return setError("Pick an account to pay from");
    setSubmitting(true);
    try {
      const url = isEdit
        ? `/api/livestock-batches/${batchId}/health/${initial!.id}`
        : `/api/livestock-batches/${batchId}/health`;
      const payload = isEdit
        ? {
            date,
            condition: condition.trim(),
            treatment: treatment.trim() || null,
            // Cost locked on edit — PATCH refuses silent re-pricing
            // of a linked Transaction.
            animalId: animalId || null,
            resolved,
            resolvedAt: resolved && resolvedAt ? resolvedAt : null,
            notes: notes.trim() || undefined,
          }
        : {
            date,
            condition: condition.trim(),
            treatment: treatment.trim() || null,
            cost: cost ? Number(cost) : null,
            animalId: animalId || null,
            accountId: hasCost ? accountId : null,
            resolved,
            resolvedAt: resolved && resolvedAt ? resolvedAt : null,
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
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Stethoscope className="h-4 w-4" />
            {isEdit ? "Edit health log" : "Log health / disease"}
          </DialogTitle>
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
                  Animal{" "}
                  <span className="font-normal text-muted-foreground">
                    (optional)
                  </span>
                </Label>
                <NativeSelect
                  value={animalId}
                  onChange={setAnimalId}
                  placeholder="— flock-level —"
                  options={[
                    { value: "", label: "— flock-level —" },
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

          <div className="space-y-1">
            <Label className="text-xs">Condition</Label>
            <Input
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
              placeholder="Coccidiosis, lameness, mastitis…"
              maxLength={120}
              autoFocus
            />
          </div>

          <DescriptionField
            label="Treatment"
            value={treatment}
            onChange={setTreatment}
            placeholder="Antibiotic given, dosage, vet name…"
            maxLength={500}
            rows={2}
          />

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">
                Cost{" "}
                <span className="font-normal text-muted-foreground">
                  {costLocked ? "(locked)" : "(₹, optional)"}
                </span>
              </Label>
              <AmountInput
                value={cost}
                onChange={setCost}
                disabled={costLocked}
              />
            </div>
            {hasCost && (
              <div className="space-y-1">
                <Label className="text-xs">Pay from</Label>
                <NativeSelect
                  value={accountId}
                  onChange={setAccountId}
                  options={groupAccountOptions(accounts, Number(cost) || 0)}
                  searchable
                />
              </div>
            )}
          </div>

          <label className="flex items-start gap-2 rounded-md border bg-muted/30 p-2.5 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={resolved}
              onChange={(e) => setResolved(e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 accent-primary"
            />
            <span>
              <span className="font-medium">Already resolved</span>
              <span className="ml-1 text-muted-foreground">
                — closes the case immediately. Otherwise it shows up as
                open on the Health tab until you mark it resolved.
              </span>
            </span>
          </label>

          {resolved && (
            <div className="space-y-1">
              <Label className="text-xs">Resolved on</Label>
              <DateInput
                value={resolvedAt || date}
                onChange={(e) => setResolvedAt(e.target.value)}
              />
            </div>
          )}

          <DescriptionField
            label="Notes"
            value={notes}
            onChange={setNotes}
            placeholder="Symptoms first noticed, severity, observations…"
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
            {submitting ? "Saving…" : isEdit ? "Save" : "Log incident"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
