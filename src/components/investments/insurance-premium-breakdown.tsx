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
  /** Amount the user pays now — the full total, or the first EMI installment. */
  onTotalChange: (total: number) => void;
  onNotesChange?: (notes: string) => void;
  /** Reports the EMI plan (or null when paying in full) so the parent form
   *  can seed the remaining installments as reminders. */
  onEmiChange?: (
    emi: { installments: number; frequency: string } | null,
  ) => void;
}

const EMI_FREQUENCIES: { value: string; label: string }[] = [
  { value: "MONTHLY", label: "Monthly" },
  { value: "QUARTERLY", label: "Quarterly" },
  { value: "HALF_YEARLY", label: "Half-yearly" },
  { value: "YEARLY", label: "Yearly" },
];

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
  onEmiChange,
}: Props) {
  const [includeLateFee, setIncludeLateFee] = useState(false);
  const [lateFeeAmount, setLateFeeAmount] = useState("");
  const [emiEnabled, setEmiEnabled] = useState(false);
  const [emiInstallments, setEmiInstallments] = useState("12");
  const [emiFrequency, setEmiFrequency] = useState("MONTHLY");
  const [emiCharge, setEmiCharge] = useState("");

  const dueInfo = getDueInfo(nextDueDate ?? null);
  const isOverdue = dueInfo?.tone === "overdue";
  const lateFee = parseFloat(lateFeeAmount) || 0;

  // EMI is only worth offering for cycles long enough to split — short
  // cycles (monthly/quarterly/half-yearly) are already frequent.
  const emiEligible = !["MONTHLY", "QUARTERLY", "HALF_YEARLY"].includes(
    frequency ?? "",
  );
  const emiActive = emiEligible && emiEnabled;
  const installments = Math.max(1, parseInt(emiInstallments, 10) || 1);
  const emiExtra = emiActive ? parseFloat(emiCharge) || 0 : 0;

  // Full cost of this premium cycle = premium + late fee + any EMI charge.
  const grossTotal = premiumAmount + (includeLateFee ? lateFee : 0) + emiExtra;
  // What the user pays now: the whole thing, or the first installment.
  const perInstallment =
    emiActive && installments > 1
      ? Math.round((grossTotal / installments) * 100) / 100
      : grossTotal;
  const dueNow = perInstallment;


  useEffect(() => {
    onTotalChange(dueNow);
  }, [dueNow, onTotalChange]);

  useEffect(() => {
    if (!onEmiChange) return;
    onEmiChange(
      emiActive && installments > 1
        ? { installments, frequency: emiFrequency }
        : null,
    );
  }, [emiActive, installments, emiFrequency, onEmiChange]);

  useEffect(() => {
    if (!onNotesChange) return;
    const parts: string[] = [`Premium — ${policyName}`];
    if (includeLateFee && lateFee > 0) parts.push(`late fee ${formatINR(lateFee)}`);
    if (emiActive && installments > 1) {
      parts.push(`EMI ${installments}× ${formatINR(perInstallment)}`);
    }
    onNotesChange(parts.join(" · "));
  }, [
    includeLateFee,
    lateFee,
    emiActive,
    installments,
    perInstallment,
    policyName,
    onNotesChange,
  ]);


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

        {emiEligible && (
          <div className="space-y-2 border-t pt-3">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={emiEnabled}
                onChange={(e) => setEmiEnabled(e.target.checked)}
                className="h-3.5 w-3.5 accent-primary"
              />
              <span className="text-xs font-medium">Pay in installments (EMI)</span>
            </label>

            {emiActive && (
              <div className="space-y-2 pl-6">
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-[10px] text-muted-foreground">
                      Installments
                    </span>
                    <Input
                      type="number"
                      min="2"
                      max="120"
                      step="1"
                      value={emiInstallments}
                      onChange={(e) => setEmiInstallments(e.target.value)}
                      className="h-8 text-sm tabular-nums"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] text-muted-foreground">
                      Every
                    </span>
                    <select
                      value={emiFrequency}
                      onChange={(e) => setEmiFrequency(e.target.value)}
                      className="mt-0.5 h-8 w-full rounded-md border bg-background px-2 text-sm"
                    >
                      {EMI_FREQUENCIES.map((f) => (
                        <option key={f.value} value={f.value}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="flex items-center justify-between gap-3">
                  <span className="text-xs text-muted-foreground">
                    Interest / processing charge
                  </span>
                  <div className="relative w-36">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground/70">
                      ₹
                    </span>
                    <Input
                      type="number"
                      min="0"
                      step="1"
                      value={emiCharge}
                      onChange={(e) => setEmiCharge(e.target.value)}
                      placeholder="0"
                      className="h-8 pl-6 text-sm text-right tabular-nums"
                    />
                  </div>
                </label>
              </div>
            )}
          </div>
        )}

        {emiActive && installments > 1 ? (
          <div className="space-y-1 border-t pt-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold">
                Paying now (installment 1 of {installments})
              </span>
              <span className="text-lg font-bold tabular-nums">
                {formatINR(perInstallment)}
              </span>
            </div>
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>
                {installments} × {formatINR(perInstallment)} ·{" "}
                {EMI_FREQUENCIES.find((f) => f.value === emiFrequency)?.label.toLowerCase() ??
                  "monthly"}
              </span>
              <span>total {formatINR(grossTotal)}</span>
            </div>
            <p className="text-[10px] text-muted-foreground">
              The remaining {installments - 1} installments are added to
              your reminders.
            </p>
          </div>
        ) : (
          <div className="flex items-center justify-between border-t pt-3">
            <span className="text-xs font-semibold">Total payable</span>
            <span className="text-lg font-bold tabular-nums">
              {formatINR(grossTotal)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
