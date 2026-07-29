"use client";

import { useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AmountInput } from "@/components/ui/amount-input";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import { DescriptionField } from "@/components/ui/description-field";
import { formatINR } from "@/lib/utils";
import {
  InstantAttachmentUploader,
  useInstantAttachmentOwnerId,
  type InstantAttachmentUploaderHandle,
} from "@/components/attachments/instant-attachment-uploader";
import type { UtilityKindValue } from "@/components/bills/utility-kind";
import { derivedBillPeriod } from "@/lib/bill-schedule";
import type { UtilityBillCycle } from "@/generated/prisma/client";
import { fetcher } from "@/lib/swr-fetcher";

type Provider = {
  id: string;
  kind: UtilityKindValue;
  providerName: string;
  /** Day of month (1–31) the provider typically bills on. Used to
   *  pre-fill the due date so the user doesn't pick it every time. */
  defaultDueDay?: number | null;
  /** Days after the bill date until it's due (grace period). Takes
   *  precedence over defaultDueDay for the due-date prefill. */
  gracePeriodDays?: number | null;
  /** Nominal cadence — seeds the "period covered" prefill. */
  billingCycle?: UtilityBillCycle | null;
  /** True when the gap between bills isn't reliable (electricity). The
   *  period prefill is then a guess worth checking, so it's shown
   *  expanded rather than tucked away. */
  cycleVaries?: boolean;
};

type Props = {
  provider: Provider;
  /** Previous bill's currentReading — auto-populates the new bill's previousReading for EB. */
  previousMeterReading?: number | null;
  onSaved: (billId: string) => void;
  onCancel: () => void;
};


function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function inDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Compute the next occurrence of `dayOfMonth`. If today is past the
 * target, advances to next month. Clamps to the last day of the month
 * when target > days in that month (so dueDay=31 → 30 Apr / 28 Feb).
 */
function nextDueDateFor(dayOfMonth: number): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const today = now.getDate();
  const targetMonth = today < dayOfMonth ? month : month + 1;
  const candidate = new Date(year, targetMonth, dayOfMonth);
  // Date overflow auto-rolls (e.g. Feb 31 → Mar 3) — clamp back.
  if (candidate.getMonth() !== ((targetMonth % 12) + 12) % 12) {
    const lastDay = new Date(year, targetMonth + 1, 0);
    return lastDay.toISOString().slice(0, 10);
  }
  return candidate.toISOString().slice(0, 10);
}

export function UtilityBillForm({
  provider,
  previousMeterReading,
  onSaved,
  onCancel,
}: Props) {
  const ownerId = useInstantAttachmentOwnerId();
  const uploaderRef = useRef<InstantAttachmentUploaderHandle | null>(null);

  // Fetch last bill if no previousMeterReading provided (for stand-alone use).
  const { data: lastBillRes } = useSWR<{ bills: { currentReading: number | null }[] }>(
    provider.kind === "ELECTRICITY" && previousMeterReading == null
      ? `/api/utility-bills?providerId=${provider.id}&status=paid`
      : null,
    fetcher,
  );
  const inferredPrev =
    previousMeterReading ?? lastBillRes?.bills?.[0]?.currentReading ?? null;

  const [billDate, setBillDate] = useState(todayIso());
  // Default due date: grace period (days after the bill) wins, else the
  // provider's fixed due day, else today + 10 days as a safe fallback.
  const [dueDate, setDueDate] = useState(
    provider.gracePeriodDays != null
      ? inDays(provider.gracePeriodDays)
      : provider.defaultDueDay != null
        ? nextDueDateFor(provider.defaultDueDay)
        : inDays(10),
  );
  const [billAmount, setBillAmount] = useState("");
  // User-typed override of previousReading. When blank, we fall through
  // to `inferredPrev` from the last paid bill so the displayed value
  // updates as SWR resolves — no reset effect needed.
  const [previousReadingOverride, setPreviousReadingOverride] = useState<string | null>(
    null,
  );
  const previousReading =
    previousReadingOverride ?? (inferredPrev != null ? String(inferredPrev) : "");
  const [currentReading, setCurrentReading] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Service window the bill covers. Seeded from the provider's nominal
  // cycle and re-seeded as the statement date moves — until the user
  // edits it, at which point their dates stick (same override pattern as
  // previousReading above). Recording the real window is what keeps the
  // period label, the ledger description and the per-month charts honest
  // when a connection bills off its usual rhythm.
  const [periodOverride, setPeriodOverride] = useState<{
    from: string;
    to: string;
  } | null>(null);
  const derivedPeriod = useMemo(() => {
    const stmt = new Date(`${billDate}T00:00:00Z`);
    if (!billDate || Number.isNaN(stmt.getTime())) return { from: "", to: "" };
    const { from, to } = derivedBillPeriod(
      stmt,
      provider.billingCycle ?? "MONTHLY",
    );
    return {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
    };
  }, [billDate, provider.billingCycle]);
  const periodFrom = periodOverride?.from ?? derivedPeriod.from;
  const periodTo = periodOverride?.to ?? derivedPeriod.to;
  const periodLength = useMemo(() => {
    if (!periodFrom || !periodTo) return null;
    const a = new Date(`${periodFrom}T00:00:00Z`).getTime();
    const b = new Date(`${periodTo}T00:00:00Z`).getTime();
    if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
    return Math.round((b - a) / 86_400_000) + 1;
  }, [periodFrom, periodTo]);

  const unitsConsumed = useMemo(() => {
    if (provider.kind !== "ELECTRICITY") return null;
    const prev = Number(previousReading);
    const curr = Number(currentReading);
    if (!Number.isFinite(prev) || !Number.isFinite(curr)) return null;
    return Math.abs(curr - prev);
  }, [provider.kind, previousReading, currentReading]);

  async function submit() {
    setError(null);
    const amountNum = Number(billAmount);
    if (!Number.isFinite(amountNum) || amountNum <= 0)
      return setError("Enter a positive bill amount");
    if (periodFrom && periodTo && periodLength == null)
      return setError("The period must end on or after it starts");
    setSubmitting(true);
    try {
      const payload = {
        clientId: ownerId,
        providerId: provider.id,
        billDate,
        dueDate,
        periodFrom: periodFrom || null,
        periodTo: periodTo || null,
        billAmount: amountNum,
        previousReading:
          previousReading !== "" ? Number(previousReading) : null,
        currentReading: currentReading !== "" ? Number(currentReading) : null,
        notes: notes.trim() || null,
      };
      const res = await fetch("/api/utility-bills", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Could not save");
        return;
      }
      onSaved(body.id);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel() {
    await uploaderRef.current?.discardAll();
    onCancel();
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Bill date</Label>
          <DateInput value={billDate} onChange={(e) => setBillDate(e.target.value)} />
        </div>
        <div>
          <Label>Due date</Label>
          <DateInput value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>
        <div className="col-span-2 rounded-md border bg-muted/20 p-2.5">
          <div className="flex items-baseline justify-between">
            <Label className="mb-0">Period covered</Label>
            <span className="text-[10px] text-muted-foreground">
              {periodLength != null
                ? `${periodLength} days`
                : "ends before it starts"}
            </span>
          </div>
          <div className="mt-1.5 grid grid-cols-2 gap-3">
            <DateInput
              value={periodFrom}
              onChange={(e) =>
                setPeriodOverride({ from: e.target.value, to: periodTo })
              }
            />
            <DateInput
              value={periodTo}
              onChange={(e) =>
                setPeriodOverride({ from: periodFrom, to: e.target.value })
              }
            />
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {provider.cycleVaries
              ? "This connection doesn't bill on a fixed gap — copy the dates from the bill so charts compare like with like."
              : "Prefilled from the billing cycle. Correct it if the bill says otherwise."}
          </p>
        </div>
        <div className="col-span-2">
          <Label>Bill amount</Label>
          <AmountInput value={billAmount} onChange={setBillAmount} />
        </div>
        {provider.kind === "ELECTRICITY" && (
          <>
            <div>
              <Label>Previous reading</Label>
              <Input
                value={previousReading}
                onChange={(e) =>
                  setPreviousReadingOverride(e.target.value.replace(/[^\d.]/g, ""))
                }
                inputMode="decimal"
                placeholder={inferredPrev != null ? String(inferredPrev) : "—"}
              />
              {inferredPrev != null && (
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Auto-filled from last bill
                </p>
              )}
            </div>
            <div>
              <Label>Current reading</Label>
              <Input
                value={currentReading}
                onChange={(e) =>
                  setCurrentReading(e.target.value.replace(/[^\d.]/g, ""))
                }
                inputMode="decimal"
              />
              {unitsConsumed != null && (
                <p className="mt-1 inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                  {unitsConsumed.toFixed(1)} units consumed
                </p>
              )}
            </div>
          </>
        )}
      </div>

      <DescriptionField
        value={notes}
        onChange={setNotes}
        label="Notes"
        maxLength={1000}
        placeholder="Optional"
      />

      <InstantAttachmentUploader
        ref={uploaderRef}
        ownerKind="UTILITY_BILL"
        ownerId={ownerId}
        draft
        maxFiles={3}
        hint="Bill PDF or screenshot. Uploads instantly to S3."
      />

      {billAmount && (
        <div className="rounded-md border bg-muted/30 p-3 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Bill total</span>
            <span className="font-semibold tabular-nums">
              {formatINR(Number(billAmount) || 0)}
            </span>
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">
            After saving, click <strong>Pay</strong> on the bill row to record
            payment — you can apply provider&rsquo;s advance balance first.
          </p>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" onClick={handleCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={submitting}>
          {submitting ? "Saving…" : "Record bill"}
        </Button>
      </div>
    </div>
  );
}
