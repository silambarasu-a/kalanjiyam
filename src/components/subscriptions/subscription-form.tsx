"use client";

import { useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AmountInput } from "@/components/ui/amount-input";
import { DateInput } from "@/components/ui/date-input";
import { NativeSelect } from "@/components/ui/native-select";
import { Label } from "@/components/ui/label";
import { DescriptionField } from "@/components/ui/description-field";
import { FundingSourcePicker } from "@/components/shared/funding-source-picker";
import {
  fundingSourceFromIds,
  fundingSourceIds,
  fundingSourceValue,
} from "@/lib/funding-sources";
import { fetcher } from "@/lib/swr-fetcher";
import { useFundingSources } from "@/lib/use-funding-sources";
import {
  InstantAttachmentUploader,
  useInstantAttachmentOwnerId,
  type InstantAttachmentUploaderHandle,
} from "@/components/attachments/instant-attachment-uploader";

const CYCLES = [
  { value: "WEEKLY", label: "Weekly" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "QUARTERLY", label: "Quarterly" },
  { value: "HALF_YEARLY", label: "Half-yearly" },
  { value: "YEARLY", label: "Yearly" },
] as const;

type Props = {
  /** Optional subscription to edit. Omit for create. */
  initial?: {
    id: string;
    name: string;
    amount: number;
    cycle: string;
    nextBillingDate: string;
    startedOn: string;
    endsOn: string | null;
    accountId: string | null;
    cardId: string | null;
    autoPay: boolean;
    notes: string | null;
  };
  onSaved: () => void;
  onCancel: () => void;
};


function todayIso() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

export function SubscriptionForm({ initial, onSaved, onCancel }: Props) {
  const isEdit = !!initial;
  const ownerId = useInstantAttachmentOwnerId();
  const uploaderRef = useRef<InstantAttachmentUploaderHandle | null>(null);

  // Same SWR keys the picker uses, so this costs no extra request. Only
  // needed for the first-account fallback below.
  const { accounts } = useFundingSources();

  // Pre-existing attachments for edit mode — hand to the uploader so
  // the user sees them already attached.
  const { data: attachmentsRes } = useSWR<{
    attachments: {
      id: string;
      filename: string;
      mimeType: string;
      sizeBytes: number;
      uploadedAt: string;
    }[];
  }>(
    isEdit
      ? `/api/attachments?ownerKind=SUBSCRIPTION_DOCUMENT&ownerId=${initial!.id}`
      : null,
    fetcher,
  );
  const initialAttachments = (attachmentsRes?.attachments ?? []).map((a) => ({
    id: a.id,
    filename: a.filename,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    uploadedAt: a.uploadedAt,
    status: "ready" as const,
  }));

  const [name, setName] = useState(initial?.name ?? "");
  const [amount, setAmount] = useState<string>(
    initial?.amount != null ? String(initial.amount) : "",
  );
  const [cycle, setCycle] = useState(initial?.cycle ?? "MONTHLY");
  const [nextBillingDate, setNextBillingDate] = useState(
    initial?.nextBillingDate?.slice(0, 10) ?? todayIso(),
  );
  const [startedOn, setStartedOn] = useState(
    initial?.startedOn?.slice(0, 10) ?? todayIso(),
  );
  const [endsOn, setEndsOn] = useState(initial?.endsOn?.slice(0, 10) ?? "");
  // "account:<id>" | "card:<id>" | "" — seeded from the subscription on edit.
  const [source, setSource] = useState(() =>
    fundingSourceFromIds({
      accountId: initial?.accountId,
      cardId: initial?.cardId,
    }),
  );
  const [autoPay, setAutoPay] = useState(initial?.autoPay ?? false);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Render-time fallback: the API requires exactly one source, so if
  // nothing is picked yet surface the first account. The user can change
  // it; submit guards against there being none at all.
  const defaultSource = useMemo(
    () =>
      fundingSourceValue(
        "account",
        accounts.find((a) => a.kind !== "CARD")?.id,
      ),
    [accounts],
  );
  const effectiveSource = source || defaultSource;

  async function submit() {
    setError(null);
    if (!name.trim()) return setError("Name is required");
    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0)
      return setError("Enter a positive amount");
    const { accountId: finalAccountId, cardId: finalCardId } =
      fundingSourceIds(effectiveSource);
    if (!finalAccountId && !finalCardId)
      return setError("Pick an account or card");

    setSubmitting(true);
    try {
      const payload = {
        name: name.trim(),
        amount: amountNum,
        cycle,
        nextBillingDate,
        startedOn,
        endsOn: endsOn || null,
        accountId: finalAccountId,
        cardId: finalCardId,
        autoPay,
        notes: notes.trim() || null,
      };
      const res = await fetch(
        isEdit ? `/api/subscriptions/${initial!.id}` : "/api/subscriptions",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Could not save");
        return;
      }
      onSaved();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel() {
    if (!isEdit) await uploaderRef.current?.discardAll();
    onCancel();
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label>Service name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Netflix, Spotify, …"
            maxLength={120}
          />
        </div>
        <div>
          <Label>Amount per cycle</Label>
          <AmountInput value={amount} onChange={setAmount} />
        </div>
        <div>
          <Label>Cycle</Label>
          <NativeSelect
            value={cycle}
            onChange={setCycle}
            options={CYCLES.map((c) => ({ value: c.value, label: c.label }))}
          />
        </div>
        <div>
          <Label>Next billing date</Label>
          <DateInput
            value={nextBillingDate}
            onChange={(e) => setNextBillingDate(e.target.value)}
          />
        </div>
        <div>
          <Label>Started on</Label>
          <DateInput
            value={startedOn}
            onChange={(e) => setStartedOn(e.target.value)}
          />
        </div>
        <div className="sm:col-span-2">
          <Label>Ends on (optional)</Label>
          <DateInput value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
        </div>
      </div>

      <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
        <div className="text-xs font-medium">Payment source</div>
        <FundingSourcePicker value={effectiveSource} onChange={setSource} />
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={autoPay}
            onChange={(e) => setAutoPay(e.target.checked)}
          />
          Auto-pay is enabled at the bank/card
        </label>
      </div>

      <DescriptionField
        value={notes}
        onChange={setNotes}
        label="Notes"
        maxLength={1000}
        placeholder="Optional"
      />

      {/* In edit mode, wait for SWR to resolve so `initial` reflects
          the persisted attachments. In create mode, mount immediately. */}
      {(!isEdit || attachmentsRes) && (
        <InstantAttachmentUploader
          ref={uploaderRef}
          ownerKind="SUBSCRIPTION_DOCUMENT"
          ownerId={isEdit ? initial!.id : ownerId}
          draft={!isEdit}
          maxFiles={3}
          initial={isEdit ? initialAttachments : undefined}
          hint="Contract, screenshot, plan details. Files upload instantly."
        />
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" onClick={handleCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={submitting}>
          {submitting ? "Saving…" : isEdit ? "Save changes" : "Add subscription"}
        </Button>
      </div>
    </div>
  );
}
