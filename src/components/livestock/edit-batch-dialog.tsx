"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
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
import { NativeSelect } from "@/components/ui/native-select";
import { DescriptionField } from "@/components/ui/description-field";
import { fetcher } from "@/lib/swr-fetcher";

type ProductionType =
  | "BROILER_CONTRACT"
  | "BROILER_INDEPENDENT"
  | "LAYER"
  | "COUNTRY_CHICKEN"
  | "DAIRY"
  | "MEAT_GOAT"
  | "MEAT_SHEEP"
  | "DUAL_PURPOSE";

const PRODUCTION_TYPES: { value: ProductionType; label: string }[] = [
  { value: "BROILER_CONTRACT", label: "Broiler · contract" },
  { value: "BROILER_INDEPENDENT", label: "Broiler · independent" },
  { value: "LAYER", label: "Layer" },
  { value: "COUNTRY_CHICKEN", label: "Country chicken" },
  { value: "DAIRY", label: "Dairy" },
  { value: "MEAT_GOAT", label: "Goat (meat)" },
  { value: "MEAT_SHEEP", label: "Sheep (meat)" },
  { value: "DUAL_PURPOSE", label: "Other / dual-purpose" },
];

type BatchEditable = {
  id: string;
  name: string;
  productionType: ProductionType;
  contractId: string | null;
  landId: string | null;
  startDate: string;
  endDate: string | null;
  expectedCycleDays: number | null;
  initialAvgWeight: number | null;
  targetWeight: number | null;
  targetFCR: number | null;
  notes: string | null;
  active: boolean;
};

/**
 * Edit every settable field on a LivestockBatch — including the
 * productionType, contract link, land link, target weights / FCR, and
 * the active flag. The same dialog handles "Reopen" (flip active=true)
 * on closed batches.
 */
export function EditBatchDialog({
  open,
  onOpenChange,
  batch,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batch: BatchEditable;
  onSaved: () => void;
}) {
  const { data: contractsRes } = useSWR<{
    contracts: { id: string; integratorName: string; contractRef: string | null }[];
  }>(open ? "/api/livestock-contracts" : null, fetcher);
  const { data: landsRes } = useSWR<{
    lands: { id: string; name: string; area: number | null; areaUnit: string | null }[];
  }>(open ? "/api/land" : null, fetcher);

  const [name, setName] = useState(batch.name);
  const [productionType, setProductionType] = useState<ProductionType>(
    batch.productionType,
  );
  const [contractId, setContractId] = useState(batch.contractId ?? "");
  const [landId, setLandId] = useState(batch.landId ?? "");
  const [startDate, setStartDate] = useState(batch.startDate.slice(0, 10));
  const [endDate, setEndDate] = useState(batch.endDate?.slice(0, 10) ?? "");
  const [expectedCycleDays, setExpectedCycleDays] = useState(
    batch.expectedCycleDays != null ? String(batch.expectedCycleDays) : "",
  );
  const [initialAvgWeight, setInitialAvgWeight] = useState(
    batch.initialAvgWeight != null ? String(batch.initialAvgWeight) : "",
  );
  const [targetWeight, setTargetWeight] = useState(
    batch.targetWeight != null ? String(batch.targetWeight) : "",
  );
  const [targetFCR, setTargetFCR] = useState(
    batch.targetFCR != null ? String(batch.targetFCR) : "",
  );
  const [notes, setNotes] = useState(batch.notes ?? "");
  const [active, setActive] = useState(batch.active);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-prime defaults each time the dialog opens with a fresh batch.
  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- reset on open */
    setName(batch.name);
    setProductionType(batch.productionType);
    setContractId(batch.contractId ?? "");
    setLandId(batch.landId ?? "");
    setStartDate(batch.startDate.slice(0, 10));
    setEndDate(batch.endDate?.slice(0, 10) ?? "");
    setExpectedCycleDays(
      batch.expectedCycleDays != null ? String(batch.expectedCycleDays) : "",
    );
    setInitialAvgWeight(
      batch.initialAvgWeight != null ? String(batch.initialAvgWeight) : "",
    );
    setTargetWeight(
      batch.targetWeight != null ? String(batch.targetWeight) : "",
    );
    setTargetFCR(batch.targetFCR != null ? String(batch.targetFCR) : "");
    setNotes(batch.notes ?? "");
    setActive(batch.active);
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, batch]);

  async function submit() {
    setError(null);
    if (!name.trim()) return setError("Name is required");
    setSubmitting(true);
    try {
      const res = await fetch(`/api/livestock-batches/${batch.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          productionType,
          contractId: contractId || null,
          landId: landId || null,
          startDate,
          endDate: endDate || null,
          expectedCycleDays: expectedCycleDays
            ? Number(expectedCycleDays)
            : null,
          initialAvgWeight: initialAvgWeight ? Number(initialAvgWeight) : null,
          targetWeight: targetWeight ? Number(targetWeight) : null,
          targetFCR: targetFCR ? Number(targetFCR) : null,
          notes: notes.trim() || null,
          active,
        }),
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

  const isContract = productionType === "BROILER_CONTRACT";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit batch</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Production type</Label>
              <NativeSelect
                value={productionType}
                onChange={(v) => setProductionType(v as ProductionType)}
                options={PRODUCTION_TYPES.map((p) => ({
                  value: p.value,
                  label: p.label,
                }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Start date</Label>
              <DateInput
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">End date (optional)</Label>
              <DateInput
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Expected cycle (days)</Label>
              <Input
                inputMode="numeric"
                value={expectedCycleDays}
                onChange={(e) =>
                  setExpectedCycleDays(
                    e.target.value.replace(/\D/g, "").slice(0, 4),
                  )
                }
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Arrival wt (kg/bird)</Label>
              <Input
                inputMode="decimal"
                value={initialAvgWeight}
                onChange={(e) =>
                  setInitialAvgWeight(
                    e.target.value.replace(/[^\d.]/g, "").slice(0, 8),
                  )
                }
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Target exit wt (kg)</Label>
              <Input
                inputMode="decimal"
                value={targetWeight}
                onChange={(e) =>
                  setTargetWeight(
                    e.target.value.replace(/[^\d.]/g, "").slice(0, 8),
                  )
                }
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Target FCR</Label>
              <Input
                inputMode="decimal"
                value={targetFCR}
                onChange={(e) =>
                  setTargetFCR(
                    e.target.value.replace(/[^\d.]/g, "").slice(0, 6),
                  )
                }
              />
            </div>
          </div>

          {isContract && (
            <div className="space-y-1">
              <Label className="text-xs">Integrator contract</Label>
              <NativeSelect
                value={contractId}
                onChange={setContractId}
                placeholder="— pick a contract —"
                options={[
                  { value: "", label: "— no contract —" },
                  ...((contractsRes?.contracts ?? []).map((c) => ({
                    value: c.id,
                    label: c.contractRef
                      ? `${c.integratorName} · ${c.contractRef}`
                      : c.integratorName,
                  }))),
                ]}
                searchable
              />
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-xs">
              Shed / land{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </Label>
            <NativeSelect
              value={landId}
              onChange={setLandId}
              placeholder="— no land link —"
              options={[
                { value: "", label: "— no land link —" },
                ...((landsRes?.lands ?? []).map((l) => ({
                  value: l.id,
                  label:
                    l.area != null && l.areaUnit
                      ? `${l.name} · ${l.area} ${l.areaUnit}`
                      : l.name,
                }))),
              ]}
              searchable
            />
          </div>

          <DescriptionField
            label="Notes"
            value={notes}
            onChange={setNotes}
            placeholder="Anything worth recording…"
            maxLength={500}
            rows={2}
          />

          <label className="flex items-start gap-2 rounded-md border bg-muted/30 p-2.5 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 accent-primary"
            />
            <span>
              <span className="font-medium">Batch is active</span>
              <span className="ml-1 text-muted-foreground">
                — uncheck to close the batch (or check to reopen a closed
                one). Closed batches stay in history but won&rsquo;t accept
                new entries through the action buttons.
              </span>
            </span>
          </label>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting || !name.trim()}>
            {submitting ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
