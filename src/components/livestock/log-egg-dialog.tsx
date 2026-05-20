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

const DEFAULT_GRADES: { key: string; label: string }[] = [
  { key: "SMALL", label: "Small" },
  { key: "MEDIUM", label: "Medium" },
  { key: "LARGE", label: "Large" },
];

/**
 * Logs (or edits) daily egg collection. Grades are tracked as an
 * extensible key/value bag (small / medium / large / jumbo / brown /
 * whatever). Sale fields (sold + per-egg price) are optional; filling
 * both creates a linked INCOME Transaction. Pass `initial` for edit
 * mode — sale fields lock when a Transaction is already linked.
 */
export function LogEggDialog({
  open,
  onOpenChange,
  batchId,
  initial,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batchId: string;
  initial?: {
    id: string;
    date: string;
    collected: number;
    grades: unknown;
    broken: number | null;
    sold: number | null;
    salePricePerEgg: number | null;
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

  const initialGrades = (() => {
    if (!initial || initial.grades == null) return null;
    const raw = initial.grades;
    if (typeof raw !== "object") return null;
    return Object.entries(raw as Record<string, number>).map(([key, n]) => ({
      key,
      count: typeof n === "number" ? String(n) : String(n),
    }));
  })();
  const [date, setDate] = useState(
    () => initial?.date.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
  );
  const [grades, setGrades] = useState<{ key: string; count: string }[]>(() =>
    initialGrades && initialGrades.length > 0
      ? initialGrades
      : initial
        ? [{ key: "MEDIUM", count: String(initial.collected) }]
        : DEFAULT_GRADES.map((g) => ({ key: g.key, count: "" })),
  );
  const [broken, setBroken] = useState(
    initial?.broken != null ? String(initial.broken) : "",
  );
  const [sold, setSold] = useState(
    initial?.sold != null ? String(initial.sold) : "",
  );
  const [salePricePerEgg, setSalePricePerEgg] = useState(
    initial?.salePricePerEgg != null ? String(initial.salePricePerEgg) : "",
  );
  const [accountId, setAccountId] = useState("");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const collected = grades.reduce(
    (sum, g) => sum + (parseInt(g.count, 10) || 0),
    0,
  );
  const brokenN = parseInt(broken, 10) || 0;
  const soldN = parseInt(sold, 10) || 0;
  const expectedRevenue =
    soldN > 0 && Number(salePricePerEgg) > 0
      ? soldN * Number(salePricePerEgg)
      : 0;
  const hasSale = expectedRevenue > 0;
  const leftover = collected - brokenN - soldN;

  function setGradeCount(key: string, count: string) {
    setGrades((cur) =>
      cur.map((g) => (g.key === key ? { ...g, count } : g)),
    );
  }
  function addGrade() {
    setGrades((cur) => [...cur, { key: `GRADE_${cur.length + 1}`, count: "" }]);
  }
  function removeGrade(key: string) {
    setGrades((cur) => cur.filter((g) => g.key !== key));
  }

  async function submit() {
    setError(null);
    if (collected <= 0) return setError("Enter at least one grade count");
    if (brokenN + soldN > collected)
      return setError("Sold + broken can't exceed collected");
    if (hasSale && !accountId)
      return setError("Pick the account / wallet that receives the sale");
    setSubmitting(true);
    try {
      const gradeMap = grades.reduce<Record<string, number>>((acc, g) => {
        const n = parseInt(g.count, 10);
        if (Number.isFinite(n) && n > 0) acc[g.key] = n;
        return acc;
      }, {});
      const url = isEdit
        ? `/api/livestock-batches/${batchId}/eggs/${initial!.id}`
        : `/api/livestock-batches/${batchId}/eggs`;
      const payload = isEdit
        ? {
            date,
            collected,
            grades: Object.keys(gradeMap).length ? gradeMap : null,
            broken: brokenN > 0 ? brokenN : null,
            // Sale fields locked on edit — PATCH refuses silent re-pricing.
            notes: notes.trim() || undefined,
          }
        : {
            date,
            collected,
            grades: Object.keys(gradeMap).length ? gradeMap : null,
            broken: brokenN > 0 ? brokenN : null,
            sold: soldN > 0 ? soldN : null,
            salePricePerEgg: salePricePerEgg ? Number(salePricePerEgg) : null,
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
          <DialogTitle>
            {isEdit ? "Edit egg log" : "Log egg collection"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Date</Label>
            <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
          </div>

          <div className="space-y-1.5 rounded-xl border bg-muted/20 p-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Collected by grade</Label>
              <Button
                size="sm"
                variant="ghost"
                onClick={addGrade}
                className="h-6 gap-1 px-1.5 text-[10px]"
              >
                <Plus className="h-3 w-3" /> Grade
              </Button>
            </div>
            {grades.map((g) => (
              <div
                key={g.key}
                className="grid grid-cols-[110px_1fr_auto] items-center gap-2"
              >
                <span className="text-[11px] text-muted-foreground">
                  {g.key
                    .replace("_", " ")
                    .toLowerCase()
                    .replace(/^./, (c) => c.toUpperCase())}
                </span>
                <Input
                  inputMode="numeric"
                  value={g.count}
                  onChange={(e) =>
                    setGradeCount(g.key, e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  placeholder="0"
                  className="h-8"
                />
                {grades.length > 1 && (
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => removeGrade(g.key)}
                    className="h-7 w-7"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                )}
              </div>
            ))}
            <div className="flex items-center justify-between border-t pt-2 text-xs">
              <span className="text-muted-foreground">Total collected</span>
              <span className="tabular-nums font-medium">{collected}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">
                Broken{" "}
                <span className="font-normal text-muted-foreground">
                  (subtracted from saleable)
                </span>
              </Label>
              <Input
                inputMode="numeric"
                value={broken}
                onChange={(e) =>
                  setBroken(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                placeholder="0"
                className="h-8"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Sold</Label>
              <Input
                inputMode="numeric"
                value={sold}
                onChange={(e) =>
                  setSold(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                placeholder="0"
                className="h-8"
                disabled={saleLocked}
              />
            </div>
          </div>

          {collected > 0 && (
            <div className="rounded-md border bg-muted/30 px-3 py-1.5 text-[11px]">
              Collected <b>{collected}</b> · broken{" "}
              <b>{brokenN}</b> · sold <b>{soldN}</b> · on-hand /
              consumed <b>{Math.max(0, leftover)}</b>
            </div>
          )}

          {soldN > 0 && (
            <div className="rounded-xl border bg-muted/20 p-3">
              <Label className="text-xs">Sale</Label>
              {saleLocked && (
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Locked — this log has a linked income transaction.
                  Delete + re-add to change.
                </p>
              )}
              <div className="mt-2 grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-[10px]">₹ per egg</Label>
                  <AmountInput
                    value={salePricePerEgg}
                    onChange={setSalePricePerEgg}
                    placeholder="8.50"
                    disabled={saleLocked}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px]">Revenue</Label>
                  <div className="flex h-9 items-center rounded-lg border bg-background px-3 text-xs">
                    <span className="font-medium tabular-nums">
                      {formatINR(expectedRevenue)}
                    </span>
                  </div>
                </div>
              </div>
              {hasSale && (
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
              )}
            </div>
          )}

          <DescriptionField
            label="Notes"
            value={notes}
            onChange={setNotes}
            placeholder="Buyer, time of collection, anything worth recording…"
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
            {submitting ? "Saving…" : isEdit ? "Save" : "Log eggs"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
