"use client";

import { useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AmountInput } from "@/components/ui/amount-input";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import { formatINR } from "@/lib/utils";
import {
  InstantAttachmentUploader,
  useInstantAttachmentOwnerId,
  type InstantAttachmentUploaderHandle,
} from "@/components/attachments/instant-attachment-uploader";
import type { UtilityKindValue } from "@/components/bills/utility-kind";
import { fetcher } from "@/lib/swr-fetcher";

type Provider = {
  id: string;
  kind: UtilityKindValue;
  providerName: string;
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
  const [dueDate, setDueDate] = useState(inDays(10));
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
    setSubmitting(true);
    try {
      const payload = {
        clientId: ownerId,
        providerId: provider.id,
        billDate,
        dueDate,
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

      <div>
        <Label>Notes</Label>
        <Input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={1000}
          placeholder="Optional"
        />
      </div>

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
