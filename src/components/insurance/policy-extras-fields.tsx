"use client";

import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AmountInput } from "@/components/ui/amount-input";
import {
  EMPTY_COVERAGE,
  VehicleCoverageEditor,
  type VehicleCoverageDraft,
} from "@/components/investments/vehicle-coverage-editor";

/**
 * Shared "extras" for the New Policy form. Owns the conditional sections
 * that depend on policyType:
 *
 *  - VEHICLE policies → vehicle picker + IDV/OD/TP/add-ons coverage
 *  - LIFE family (LIFE / TERM / ULIP / ENDOWMENT) → policy term, premium
 *    term, maturity value, bonus accrued + Beneficiaries (with share %)
 *  - HEALTH / OTHER → Covered members (per-person premium override)
 *
 * Mounted by both the /insurance NewPolicyDialog and the transaction
 * dialog's Invest → INSURANCE branch so they stay in sync — adding a
 * field in one place adds it in the other.
 */

export type PolicyType =
  | "LIFE"
  | "HEALTH"
  | "VEHICLE"
  | "HOME"
  | "TRAVEL"
  | "TERM"
  | "ULIP"
  | "ENDOWMENT"
  | "OTHER";

export type DraftMember = {
  contactId: string;
  premiumAmount: string;
  role: "INSURED" | "BENEFICIARY";
  sharePercent: string;
};

export type InsurancePolicyExtras = {
  vehicleId: string;
  policyTermYears: string;
  premiumPayingTermYears: string;
  maturityValue: string;
  bonusAccrued: string;
  members: DraftMember[];
  coverage: VehicleCoverageDraft;
};

export const EMPTY_INSURANCE_EXTRAS: InsurancePolicyExtras = {
  vehicleId: "",
  policyTermYears: "",
  premiumPayingTermYears: "",
  maturityValue: "",
  bonusAccrued: "",
  members: [],
  coverage: EMPTY_COVERAGE,
};

export function isLifeFamily(t: PolicyType | string | null): boolean {
  return (
    t === "LIFE" || t === "TERM" || t === "ULIP" || t === "ENDOWMENT"
  );
}

/**
 * Member rows that have any per-row data but are missing a contact (or
 * the role-specific required field). These would silently drop on save
 * if we let them through; the caller should block submit on this list.
 */
export function incompleteMemberRows(
  members: DraftMember[],
): { idx: number; row: DraftMember }[] {
  return members
    .map((row, idx) => ({ row, idx }))
    .filter(({ row }) => {
      if (!row.contactId) {
        return !!(row.premiumAmount || row.sharePercent);
      }
      if (row.role === "BENEFICIARY" && !row.sharePercent) return true;
      return false;
    });
}

/**
 * Build the slice of POST /api/investments payload that the extras
 * populate (vehicleId, life-family corporate fields, metadata.coverage).
 * Caller merges this with their own basic-fields payload.
 */
export function buildInsuranceExtraPayload(
  extras: InsurancePolicyExtras,
  policyType: PolicyType | string,
  baseMetadata: Record<string, unknown> | null = null,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (policyType === "VEHICLE" && extras.vehicleId) {
    payload.vehicleId = extras.vehicleId;
  }
  if (isLifeFamily(policyType)) {
    if (extras.policyTermYears) {
      payload.policyTermYears = Number(extras.policyTermYears);
    }
    if (extras.premiumPayingTermYears) {
      payload.premiumPayingTermYears = Number(extras.premiumPayingTermYears);
    }
    if (extras.maturityValue) {
      payload.maturityValue = Number(extras.maturityValue);
    }
    if (extras.bonusAccrued) {
      payload.bonusAccrued = Number(extras.bonusAccrued);
    }
  }
  if (policyType === "VEHICLE") {
    const c = serializeCoverageLocal(extras.coverage);
    if (c) {
      payload.metadata = { ...(baseMetadata ?? {}), coverage: c };
    }
  }
  return payload;
}

// Local copy to avoid a circular import — the editor component owns the
// canonical serializer; we duplicate the shape here. Keep in sync.
function serializeCoverageLocal(
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

/**
 * POST every member row to /api/insurance/[id]/members. Returns the list
 * of error messages (if any) so the caller can surface a partial-success
 * state. Members with empty contactId are skipped — caller should have
 * already blocked on `incompleteMemberRows()`.
 */
export async function submitPolicyMembers(
  policyId: string,
  members: DraftMember[],
  premiumFrequency: string,
): Promise<string[]> {
  const errors: string[] = [];
  const payloads = members
    .filter((m) => m.contactId)
    .map((m) => ({
      contactId: m.contactId,
      premiumAmount: m.premiumAmount ? Number(m.premiumAmount) : undefined,
      premiumFrequency: m.premiumAmount ? premiumFrequency : undefined,
      role: m.role,
      sharePercent:
        m.role === "BENEFICIARY" && m.sharePercent
          ? Number(m.sharePercent)
          : undefined,
    }));
  for (const payload of payloads) {
    const res = await fetch(`/api/insurance/${policyId}/members`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      errors.push(body.error ?? "Failed to add a member");
    }
  }
  return errors;
}

export function InsurancePolicyExtrasFields({
  policyType,
  premiumFrequency,
  value,
  onChange,
  contacts,
  vehicles,
}: {
  policyType: PolicyType | string;
  premiumFrequency: string;
  value: InsurancePolicyExtras;
  onChange: (next: InsurancePolicyExtras) => void;
  contacts: { id: string; name: string }[];
  vehicles: {
    id: string;
    name: string;
    kind: string;
    registrationNo: string | null;
  }[];
}) {
  const lifeFamily = isLifeFamily(policyType);
  const isVehicle = policyType === "VEHICLE";

  function patch<K extends keyof InsurancePolicyExtras>(
    key: K,
    next: InsurancePolicyExtras[K],
  ) {
    onChange({ ...value, [key]: next });
  }

  function addMember() {
    onChange({
      ...value,
      members: [
        ...value.members,
        {
          contactId: "",
          premiumAmount: "",
          role: lifeFamily ? "BENEFICIARY" : "INSURED",
          sharePercent: "",
        },
      ],
    });
  }

  function patchMember(idx: number, patchObj: Partial<DraftMember>) {
    onChange({
      ...value,
      members: value.members.map((m, i) =>
        i === idx ? { ...m, ...patchObj } : m,
      ),
    });
  }

  function removeMember(idx: number) {
    onChange({
      ...value,
      members: value.members.filter((_, i) => i !== idx),
    });
  }

  const incompletes = incompleteMemberRows(value.members);

  return (
    <div className="space-y-3">
      {isVehicle && (
        <label className="block">
          <span className="text-xs font-medium">Vehicle covered</span>
          <select
            className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
            value={value.vehicleId}
            onChange={(e) => patch("vehicleId", e.target.value)}
          >
            <option value="">— pick a vehicle —</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
                {v.registrationNo ? ` · ${v.registrationNo}` : ""} (
                {v.kind.toLowerCase()})
              </option>
            ))}
          </select>
          {vehicles.length === 0 && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              No vehicles yet.{" "}
              <Link href="/vehicles" className="underline">
                Add a vehicle
              </Link>{" "}
              first.
            </p>
          )}
        </label>
      )}

      {isVehicle && (
        <VehicleCoverageEditor
          value={value.coverage}
          onChange={(next) => patch("coverage", next)}
        />
      )}

      {lifeFamily && (
        <div className="rounded-md border bg-muted/30 p-3 space-y-3">
          <div>
            <div className="text-xs font-medium">Policy schedule</div>
            <div className="text-[10px] text-muted-foreground">
              Corporate fields for life-family policies. All optional.
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium">Policy term (years)</span>
              <Input
                inputMode="numeric"
                value={value.policyTermYears}
                onChange={(e) =>
                  patch(
                    "policyTermYears",
                    e.target.value.replace(/\D/g, "").slice(0, 3),
                  )
                }
                placeholder="e.g. 20"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium">Premium-paying term</span>
              <Input
                inputMode="numeric"
                value={value.premiumPayingTermYears}
                onChange={(e) =>
                  patch(
                    "premiumPayingTermYears",
                    e.target.value.replace(/\D/g, "").slice(0, 3),
                  )
                }
                placeholder="e.g. 10"
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium">Maturity value</span>
              <AmountInput
                value={value.maturityValue}
                onChange={(v) => patch("maturityValue", v)}
                placeholder="0"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium">Bonus accrued</span>
              <AmountInput
                value={value.bonusAccrued}
                onChange={(v) => patch("bonusAccrued", v)}
                placeholder="0"
              />
            </label>
          </div>
        </div>
      )}

      <div className="rounded-md border bg-muted/30 p-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-medium">
              {lifeFamily ? "Beneficiaries" : "Covered members"}
            </div>
            <div className="text-[10px] text-muted-foreground">
              {lifeFamily
                ? "People who receive the benefit on maturity / claim. Shares must sum to ≤ 100%."
                : "Family / individuals on this policy. Per-member premium is optional — leave blank to share the policy premium."}
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={addMember}
            disabled={contacts.length === 0}
            className="gap-1"
          >
            <Plus className="h-3 w-3" /> Add{" "}
            {lifeFamily ? "beneficiary" : "member"}
          </Button>
        </div>
        {contacts.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            No contacts yet.{" "}
            <Link href="/contacts" className="underline">
              Add family members on Contacts
            </Link>
            , then re-open this dialog.
          </p>
        ) : value.members.length === 0 ? (
          <p className="mt-2 text-[11px] text-muted-foreground">
            None added. You can add them later from the policy detail page too.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {value.members.map((m, idx) => {
              const isIncomplete = incompletes.some((x) => x.idx === idx);
              return (
                <li
                  key={idx}
                  className={`grid grid-cols-[1fr_140px_auto] items-end gap-2 ${
                    isIncomplete ? "rounded-md border border-destructive/60 p-1" : ""
                  }`}
                >
                  <label className="block">
                    <span className="text-[10px] font-medium">
                      {lifeFamily ? "Beneficiary" : "Member"}
                    </span>
                    <select
                      className="mt-0.5 w-full rounded-md border bg-background px-2 py-1.5 text-xs"
                      value={m.contactId}
                      onChange={(e) =>
                        patchMember(idx, { contactId: e.target.value })
                      }
                    >
                      <option value="">— pick contact —</option>
                      {contacts.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {lifeFamily ? (
                    <label className="block">
                      <span className="text-[10px] font-medium">Share %</span>
                      <Input
                        inputMode="decimal"
                        value={m.sharePercent}
                        onChange={(e) =>
                          patchMember(idx, {
                            sharePercent: e.target.value
                              .replace(/[^\d.]/g, "")
                              .slice(0, 6),
                          })
                        }
                        placeholder="0"
                        className="mt-0.5 h-8 text-xs"
                      />
                    </label>
                  ) : (
                    <label className="block">
                      <span className="text-[10px] font-medium">Premium</span>
                      <AmountInput
                        value={m.premiumAmount}
                        onChange={(v) => patchMember(idx, { premiumAmount: v })}
                        placeholder="Inherit"
                      />
                    </label>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeMember(idx)}
                    aria-label="Remove member"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        {!lifeFamily && value.members.length > 0 && (
          <p className="mt-2 text-[10px] text-muted-foreground">
            Each member with their own premium gets a separate reminder. Members
            without a premium share the policy premium.
          </p>
        )}
        {lifeFamily && value.members.length > 0 && (
          <p className="mt-2 text-[10px] text-muted-foreground">
            Total share:{" "}
            {value.members
              .filter((m) => m.role === "BENEFICIARY")
              .reduce((s, m) => s + (Number(m.sharePercent) || 0), 0)
              .toFixed(2)}
            %
          </p>
        )}
      </div>

      <p className="hidden">
        Frequency context for member premiums: {premiumFrequency}
      </p>
    </div>
  );
}
