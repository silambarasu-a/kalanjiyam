"use client";

import { Plus, X } from "lucide-react";
import { AmountInput } from "@/components/ui/amount-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Coverage breakdown for vehicle insurance policies. Stored on
 * `Investment.metadata.coverage` as a free-form JSON blob — schemaless on
 * purpose because every insurer ships different add-on bundles. The shape:
 *
 *   { idv, od, tp, addOns: [{ name, premium }] }
 *
 * Empty fields collapse to null/undefined on save so listing reports can
 * tell "user typed 0" from "user left blank".
 */

export type VehicleCoverageDraft = {
  idv: string;
  od: string;
  tp: string;
  addOns: { name: string; premium: string }[];
};

export const EMPTY_COVERAGE: VehicleCoverageDraft = {
  idv: "",
  od: "",
  tp: "",
  addOns: [],
};

export function coverageFromMetadata(
  metadata: unknown,
): VehicleCoverageDraft {
  if (!metadata || typeof metadata !== "object") return EMPTY_COVERAGE;
  const m = metadata as Record<string, unknown>;
  const c = m.coverage;
  if (!c || typeof c !== "object") return EMPTY_COVERAGE;
  const cov = c as Record<string, unknown>;
  const addOnsRaw = Array.isArray(cov.addOns) ? cov.addOns : [];
  return {
    idv: cov.idv == null ? "" : String(cov.idv),
    od: cov.od == null ? "" : String(cov.od),
    tp: cov.tp == null ? "" : String(cov.tp),
    addOns: addOnsRaw
      .filter((a): a is Record<string, unknown> => !!a && typeof a === "object")
      .map((a) => ({
        name: a.name == null ? "" : String(a.name),
        premium: a.premium == null ? "" : String(a.premium),
      })),
  };
}

export function serializeCoverage(
  draft: VehicleCoverageDraft,
): {
  idv: number | null;
  od: number | null;
  tp: number | null;
  addOns: { name: string; premium: number | null }[];
} | null {
  const idv = draft.idv ? Number(draft.idv) : null;
  const od = draft.od ? Number(draft.od) : null;
  const tp = draft.tp ? Number(draft.tp) : null;
  const addOns = draft.addOns
    .map((a) => ({
      name: a.name.trim(),
      premium: a.premium ? Number(a.premium) : null,
    }))
    .filter((a) => a.name.length > 0);
  if (idv == null && od == null && tp == null && addOns.length === 0) {
    return null;
  }
  return { idv, od, tp, addOns };
}

export function VehicleCoverageEditor({
  value,
  onChange,
}: {
  value: VehicleCoverageDraft;
  onChange: (next: VehicleCoverageDraft) => void;
}) {
  function setField<K extends keyof VehicleCoverageDraft>(
    key: K,
    next: VehicleCoverageDraft[K],
  ) {
    onChange({ ...value, [key]: next });
  }
  function addAddOn() {
    onChange({ ...value, addOns: [...value.addOns, { name: "", premium: "" }] });
  }
  function patchAddOn(idx: number, patch: Partial<{ name: string; premium: string }>) {
    onChange({
      ...value,
      addOns: value.addOns.map((a, i) => (i === idx ? { ...a, ...patch } : a)),
    });
  }
  function removeAddOn(idx: number) {
    onChange({
      ...value,
      addOns: value.addOns.filter((_, i) => i !== idx),
    });
  }

  return (
    <div className="rounded-md border bg-muted/30 p-3 space-y-3">
      <div>
        <div className="text-xs font-medium">Coverage breakdown</div>
        <div className="text-[10px] text-muted-foreground">
          Comprehensive policies split into Own Damage + Third Party + add-ons.
          All optional — fill what your schedule lists.
        </div>
      </div>
      <label className="block">
        <span className="text-xs font-medium">
          IDV{" "}
          <span className="font-normal text-muted-foreground">(Insured Declared Value)</span>
        </span>
        <AmountInput
          value={value.idv}
          onChange={(v) => setField("idv", v)}
          placeholder="0"
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-medium">Own Damage premium</span>
          <AmountInput
            value={value.od}
            onChange={(v) => setField("od", v)}
            placeholder="0"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium">Third Party premium</span>
          <AmountInput
            value={value.tp}
            onChange={(v) => setField("tp", v)}
            placeholder="0"
          />
        </label>
      </div>
      <div>
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium">Add-ons</div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={addAddOn}
            className="gap-1"
          >
            <Plus className="h-3 w-3" /> Add
          </Button>
        </div>
        {value.addOns.length === 0 ? (
          <p className="mt-1 text-[11px] text-muted-foreground">
            e.g. Zero depreciation, Engine protect, Roadside assistance.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {value.addOns.map((a, idx) => (
              <li key={idx} className="grid grid-cols-[1fr_140px_auto] items-end gap-2">
                <Input
                  placeholder="Add-on name"
                  value={a.name}
                  onChange={(e) => patchAddOn(idx, { name: e.target.value })}
                  maxLength={80}
                />
                <AmountInput
                  value={a.premium}
                  onChange={(v) => patchAddOn(idx, { premium: v })}
                  placeholder="Premium"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeAddOn(idx)}
                  aria-label="Remove add-on"
                >
                  <X className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
