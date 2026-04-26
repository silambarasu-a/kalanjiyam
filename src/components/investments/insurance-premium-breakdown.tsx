"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { formatINR } from "@/lib/utils";

function getDueInfo(
  nextDueDate: string | Date | null,
): { label: string; tone: "overdue" | "soon" | "ok" } | null {
  if (!nextDueDate) return null;
  const due = new Date(nextDueDate);
  const now = new Date();
  due.setHours(0, 0, 0, 0);
  now.setHours(0, 0, 0, 0);
  const diff = Math.round((due.getTime() - now.getTime()) / 86400000);
  if (diff < 0) return { label: `${Math.abs(diff)} days overdue`, tone: "overdue" };
  if (diff === 0) return { label: "Due today", tone: "soon" };
  if (diff <= 7) return { label: `Due in ${diff} days`, tone: "soon" };
  if (diff <= 30) return { label: `Due in ${diff} days`, tone: "ok" };
  return { label: `Due in ${diff} days`, tone: "ok" };
}

const TONE_CLASS: Record<"overdue" | "soon" | "ok", string> = {
  overdue: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  soon: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  ok: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
};

interface Props {
  policyName: string;
  institution?: string | null;
  premiumAmount: number;
  nextDueDate?: string | Date | null;
  frequency?: string | null;
  onTotalChange: (total: number) => void;
  onNotesChange?: (notes: string) => void;
}

/**
 * Premium + late-fee breakdown shown when a user pays an INSURANCE premium
 * for an existing holding. Auto-fills `amount` from premium, lets the user
 * tack on a late fee (auto-suggested when overdue), and reports the total
 * back to the parent form.
 */
export function InsurancePremiumBreakdown({
  policyName,
  institution,
  premiumAmount,
  nextDueDate,
  frequency,
  onTotalChange,
  onNotesChange,
}: Props) {
  const [includeLateFee, setIncludeLateFee] = useState(false);
  const [lateFeeAmount, setLateFeeAmount] = useState("");

  const dueInfo = getDueInfo(nextDueDate ?? null);
  const isOverdue = dueInfo?.tone === "overdue";
  const lateFee = parseFloat(lateFeeAmount) || 0;
  const total = premiumAmount + (includeLateFee ? lateFee : 0);

  /* eslint-disable react-hooks/set-state-in-effect -- propagating computed total to parent form */
  useEffect(() => {
    onTotalChange(total);
  }, [total, onTotalChange]);

  useEffect(() => {
    if (!onNotesChange) return;
    if (includeLateFee && lateFee > 0) {
      onNotesChange(`Premium ${formatINR(premiumAmount)} + Late fee ${formatINR(lateFee)}`);
    } else {
      onNotesChange(`Premium — ${policyName}`);
    }
  }, [includeLateFee, lateFee, premiumAmount, policyName, onNotesChange]);
  /* eslint-enable react-hooks/set-state-in-effect */

  return (
    <div className="rounded-lg border bg-muted/30 overflow-hidden">
      <div className="border-b bg-background px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{policyName}</p>
            {institution && (
              <p className="mt-0.5 text-[11px] text-muted-foreground truncate">{institution}</p>
            )}
          </div>
          {dueInfo && (
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${TONE_CLASS[dueInfo.tone]}`}
            >
              {dueInfo.label}
            </span>
          )}
        </div>
      </div>

      <div className="space-y-3 px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Premium</span>
          <span className="text-sm font-semibold tabular-nums">{formatINR(premiumAmount)}</span>
        </div>

        {frequency !== "ONE_TIME" && (
          <div className="space-y-2">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={includeLateFee}
                onChange={(e) => {
                  setIncludeLateFee(e.target.checked);
                  if (!e.target.checked) setLateFeeAmount("");
                }}
                className="h-3.5 w-3.5 accent-primary"
              />
              <span className="text-xs font-medium">Include late fee</span>
              {isOverdue && !includeLateFee && (
                <span className="text-[10px] text-destructive">
                  Overdue — check if a late fee applies
                </span>
              )}
            </label>

            {includeLateFee && (
              <div className="flex items-center justify-between gap-3 pl-6">
                <span className="text-xs text-muted-foreground">Late fee</span>
                <div className="relative w-36">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground/70">
                    ₹
                  </span>
                  <Input
                    type="number"
                    min="0"
                    step="1"
                    value={lateFeeAmount}
                    onChange={(e) => setLateFeeAmount(e.target.value)}
                    placeholder="0"
                    className="h-8 pl-6 text-sm text-right tabular-nums"
                    autoFocus
                  />
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-between border-t pt-3">
          <span className="text-xs font-semibold">Total payable</span>
          <span className="text-lg font-bold tabular-nums">{formatINR(total)}</span>
        </div>
      </div>
    </div>
  );
}
