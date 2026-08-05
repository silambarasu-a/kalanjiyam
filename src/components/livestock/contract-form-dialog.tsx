"use client";

import { useState } from "react";
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
import { NativeSelect } from "@/components/ui/native-select";
import { DescriptionField } from "@/components/ui/description-field";
import { fetcher } from "@/lib/swr-fetcher";

const SUPPLY_OPTS = ["DOC", "FEED", "MEDICINE", "VACCINES", "TECH"] as const;

type Band = { maxFcr: string; bonusPerKg: string };
type Penalty = { overByPct: string; deductPerKg: string };

/**
 * Create / edit a LivestockContract. The bonus + penalty bands are
 * little inline editors so the user doesn't have to hand-author JSON.
 */
export function ContractFormDialog({
  open,
  onOpenChange,
  initial,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: {
    id: string;
    integratorName: string;
    contractRef: string | null;
    contactId: string | null;
    agreedRatePerKg: number;
    mortalityCap: number | null;
    suppliesProvided: string[];
    notes: string | null;
    startedOn: string;
    endedOn: string | null;
    fcrBonusBands: unknown;
    mortalityPenalty: unknown;
  };
  onSaved: (contractId?: string) => void;
}) {
  const { data: contactsRes } = useSWR<{
    members: { id: string; name: string }[];
  }>(open ? "/api/contacts" : null, fetcher);

  const isEdit = !!initial?.id;

  const [integratorName, setIntegratorName] = useState(
    initial?.integratorName ?? "",
  );
  const [contractRef, setContractRef] = useState(initial?.contractRef ?? "");
  const [contactId, setContactId] = useState(initial?.contactId ?? "");
  const [agreedRatePerKg, setAgreedRatePerKg] = useState(
    initial?.agreedRatePerKg ? String(initial.agreedRatePerKg) : "",
  );
  const [mortalityCap, setMortalityCap] = useState(
    initial?.mortalityCap != null ? String(initial.mortalityCap) : "",
  );
  const [supplies, setSupplies] = useState<string[]>(
    initial?.suppliesProvided ?? ["DOC", "FEED", "MEDICINE"],
  );
  const [startedOn, setStartedOn] = useState(
    initial?.startedOn?.slice(0, 10) ??
      new Date().toISOString().slice(0, 10),
  );
  const [endedOn, setEndedOn] = useState(initial?.endedOn?.slice(0, 10) ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [bands, setBands] = useState<Band[]>(() =>
    Array.isArray(initial?.fcrBonusBands)
      ? (initial!.fcrBonusBands as { maxFcr: number; bonusPerKg: number }[]).map(
          (b) => ({
            maxFcr: String(b.maxFcr),
            bonusPerKg: String(b.bonusPerKg),
          }),
        )
      : [],
  );
  const [penalties, setPenalties] = useState<Penalty[]>(() =>
    Array.isArray(initial?.mortalityPenalty)
      ? (
          initial!.mortalityPenalty as { overByPct: number; deductPerKg: number }[]
        ).map((p) => ({
          overByPct: String(p.overByPct),
          deductPerKg: String(p.deductPerKg),
        }))
      : [],
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleSupply(s: string) {
    setSupplies((cur) =>
      cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s],
    );
  }

  async function submit() {
    setError(null);
    const rate = Number(agreedRatePerKg);
    if (!integratorName.trim()) return setError("Integrator name is required");
    if (!Number.isFinite(rate) || rate <= 0)
      return setError("Rate per kg must be positive");

    const cleanBands = bands
      .map((b) => ({
        maxFcr: Number(b.maxFcr),
        bonusPerKg: Number(b.bonusPerKg),
      }))
      .filter(
        (b) =>
          Number.isFinite(b.maxFcr) &&
          b.maxFcr > 0 &&
          Number.isFinite(b.bonusPerKg),
      );
    const cleanPenalties = penalties
      .map((p) => ({
        overByPct: Number(p.overByPct),
        deductPerKg: Number(p.deductPerKg),
      }))
      .filter(
        (p) =>
          Number.isFinite(p.overByPct) &&
          p.overByPct >= 0 &&
          Number.isFinite(p.deductPerKg) &&
          p.deductPerKg >= 0,
      );

    setSubmitting(true);
    try {
      const url = isEdit
        ? `/api/livestock-contracts/${initial?.id}`
        : `/api/livestock-contracts`;
      const res = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          integratorName: integratorName.trim(),
          contractRef: contractRef.trim() || null,
          contactId: contactId || null,
          agreedRatePerKg: rate,
          fcrBonusBands: cleanBands.length ? cleanBands : null,
          mortalityCap: mortalityCap ? Number(mortalityCap) : null,
          mortalityPenalty: cleanPenalties.length ? cleanPenalties : null,
          suppliesProvided: supplies,
          notes: notes.trim() || null,
          startedOn,
          endedOn: endedOn || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Failed to save");
        return;
      }
      onOpenChange(false);
      onSaved(body.id);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit contract" : "New contract"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Integrator</Label>
              <Input
                value={integratorName}
                onChange={(e) => setIntegratorName(e.target.value)}
                placeholder="Suguna, Sakthi, Venky's…"
                maxLength={120}
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Contract / farmer ID</Label>
              <Input
                value={contractRef}
                onChange={(e) => setContractRef(e.target.value)}
                placeholder="e.g. SUG-TN-4521"
                maxLength={80}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">
              Contact (optional · link the integrator to a Contact for ledger / settlement)
            </Label>
            <NativeSelect
              value={contactId}
              onChange={setContactId}
              placeholder="— no contact —"
              options={[
                { value: "", label: "— no contact —" },
                ...(contactsRes?.members ?? []).map((c) => ({
                  value: c.id,
                  label: c.name,
                })),
              ]}
              searchable
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-xs">Started on</Label>
              <DateInput
                value={startedOn}
                onChange={(e) => setStartedOn(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Ended on (optional)</Label>
              <DateInput
                value={endedOn}
                onChange={(e) => setEndedOn(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Base rate (₹ / kg)</Label>
              <Input
                inputMode="decimal"
                value={agreedRatePerKg}
                onChange={(e) =>
                  setAgreedRatePerKg(
                    e.target.value.replace(/[^\d.]/g, "").slice(0, 10),
                  )
                }
                placeholder="9.50"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Supplies provided by integrator</Label>
            <div className="flex flex-wrap gap-1.5">
              {SUPPLY_OPTS.map((s) => {
                const active = supplies.includes(s);
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleSupply(s)}
                    className={`rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${
                      active
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-input bg-card text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border bg-muted/20 p-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold">FCR bonus bands</h3>
                <p className="text-[11px] text-muted-foreground">
                  Lower FCR pays more per kg. Bands evaluated lowest-to-highest;
                  first match wins.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setBands((b) => [
                    ...b,
                    { maxFcr: "", bonusPerKg: "" },
                  ])
                }
                className="gap-1"
              >
                <Plus className="h-3.5 w-3.5" /> Band
              </Button>
            </div>
            {bands.length === 0 ? (
              <p className="mt-2 text-[11px] text-muted-foreground">
                No bonus structure — flat rate applies.
              </p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {bands.map((b, i) => (
                  <li
                    key={i}
                    className="grid grid-cols-[1fr_1fr_auto] items-center gap-2"
                  >
                    <Input
                      inputMode="decimal"
                      value={b.maxFcr}
                      onChange={(e) =>
                        setBands((cur) =>
                          cur.map((x, idx) =>
                            idx === i ? { ...x, maxFcr: e.target.value } : x,
                          ),
                        )
                      }
                      placeholder="Max FCR (e.g. 1.7)"
                    />
                    <Input
                      inputMode="decimal"
                      value={b.bonusPerKg}
                      onChange={(e) =>
                        setBands((cur) =>
                          cur.map((x, idx) =>
                            idx === i
                              ? { ...x, bonusPerKg: e.target.value }
                              : x,
                          ),
                        )
                      }
                      placeholder="₹ bonus / kg"
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() =>
                        setBands((cur) => cur.filter((_, idx) => idx !== i))
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-xl border bg-muted/20 p-3">
            <div className="grid grid-cols-[1fr_auto] items-center gap-3">
              <div>
                <h3 className="text-sm font-semibold">Mortality penalty</h3>
                <p className="text-[11px] text-muted-foreground">
                  Penalty kicks in when mortality % exceeds the cap.
                </p>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">Cap (%)</Label>
                <Input
                  inputMode="decimal"
                  value={mortalityCap}
                  onChange={(e) =>
                    setMortalityCap(
                      e.target.value.replace(/[^\d.]/g, "").slice(0, 6),
                    )
                  }
                  placeholder="5.00"
                  className="h-8 w-24"
                />
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground">
                Bands evaluated highest-overage-first.
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setPenalties((p) => [
                    ...p,
                    { overByPct: "", deductPerKg: "" },
                  ])
                }
                className="gap-1"
              >
                <Plus className="h-3.5 w-3.5" /> Band
              </Button>
            </div>
            {penalties.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {penalties.map((p, i) => (
                  <li
                    key={i}
                    className="grid grid-cols-[1fr_1fr_auto] items-center gap-2"
                  >
                    <Input
                      inputMode="decimal"
                      value={p.overByPct}
                      onChange={(e) =>
                        setPenalties((cur) =>
                          cur.map((x, idx) =>
                            idx === i
                              ? { ...x, overByPct: e.target.value }
                              : x,
                          ),
                        )
                      }
                      placeholder="Over cap by (%)"
                    />
                    <Input
                      inputMode="decimal"
                      value={p.deductPerKg}
                      onChange={(e) =>
                        setPenalties((cur) =>
                          cur.map((x, idx) =>
                            idx === i
                              ? { ...x, deductPerKg: e.target.value }
                              : x,
                          ),
                        )
                      }
                      placeholder="₹ deduct / kg"
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() =>
                        setPenalties((cur) =>
                          cur.filter((_, idx) => idx !== i),
                        )
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <DescriptionField
            label="Notes"
            value={notes}
            onChange={setNotes}
            placeholder="Pickup arrangement, technical support, special terms…"
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
            {submitting ? "Saving…" : isEdit ? "Save contract" : "Create contract"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
