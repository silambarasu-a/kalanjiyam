"use client";

import { useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AmountInput } from "@/components/ui/amount-input";
import { DateInput } from "@/components/ui/date-input";
import { NativeSelect } from "@/components/ui/native-select";
import { Label } from "@/components/ui/label";
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

type Account = { id: string; name: string; kind: string };
type Card = { id: string; name: string };

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

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function todayIso() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

export function SubscriptionForm({ initial, onSaved, onCancel }: Props) {
  const isEdit = !!initial;
  const ownerId = useInstantAttachmentOwnerId();
  const uploaderRef = useRef<InstantAttachmentUploaderHandle | null>(null);

  const { data: accountsRes } = useSWR<{ accounts: (Account & { balance: number })[] }>(
    "/api/accounts",
    fetcher,
  );
  const { data: cardsRes } = useSWR<{ cards: Card[] }>("/api/cards", fetcher);

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
  const [sourceMode, setSourceMode] = useState<"account" | "card">(
    initial?.cardId ? "card" : "account",
  );
  const [accountId, setAccountId] = useState(initial?.accountId ?? "");
  const [cardId, setCardId] = useState(initial?.cardId ?? "");
  const [autoPay, setAutoPay] = useState(initial?.autoPay ?? false);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accountOptions = useMemo(
    () =>
      (accountsRes?.accounts ?? []).map((a) => ({
        value: a.id,
        label: a.name,
        hint: a.kind,
      })),
    [accountsRes],
  );
  const cardOptions = useMemo(
    () =>
      (cardsRes?.cards ?? []).map((c) => ({ value: c.id, label: c.name })),
    [cardsRes],
  );
  // Render-time fallback: if nothing picked yet, surface the first
  // option as a placeholder. The user can change it; submit guards
  // against empty values.
  const effectiveAccountId =
    accountId || (sourceMode === "account" ? accountOptions[0]?.value ?? "" : "");
  const effectiveCardId =
    cardId || (sourceMode === "card" ? cardOptions[0]?.value ?? "" : "");

  async function submit() {
    setError(null);
    if (!name.trim()) return setError("Name is required");
    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0)
      return setError("Enter a positive amount");
    const finalAccountId = effectiveAccountId;
    const finalCardId = effectiveCardId;
    if (sourceMode === "account" && !finalAccountId)
      return setError("Pick an account");
    if (sourceMode === "card" && !finalCardId) return setError("Pick a card");

    setSubmitting(true);
    try {
      const payload = {
        name: name.trim(),
        amount: amountNum,
        cycle,
        nextBillingDate,
        startedOn,
        endsOn: endsOn || null,
        accountId: sourceMode === "account" ? finalAccountId : null,
        cardId: sourceMode === "card" ? finalCardId : null,
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
        <div className="flex gap-2 text-xs">
          <button
            type="button"
            onClick={() => setSourceMode("account")}
            className={`rounded-md border px-3 py-1.5 ${
              sourceMode === "account" ? "bg-foreground text-background" : "bg-background"
            }`}
          >
            Account
          </button>
          <button
            type="button"
            onClick={() => setSourceMode("card")}
            className={`rounded-md border px-3 py-1.5 ${
              sourceMode === "card" ? "bg-foreground text-background" : "bg-background"
            }`}
          >
            Card
          </button>
        </div>
        {sourceMode === "account" ? (
          <NativeSelect
            value={effectiveAccountId}
            onChange={setAccountId}
            options={accountOptions}
            placeholder="Select account"
          />
        ) : (
          <NativeSelect
            value={effectiveCardId}
            onChange={setCardId}
            options={cardOptions}
            placeholder="Select card"
          />
        )}
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={autoPay}
            onChange={(e) => setAutoPay(e.target.checked)}
          />
          Auto-pay is enabled at the bank/card
        </label>
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
