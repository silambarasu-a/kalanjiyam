"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { AmountInput } from "@/components/ui/amount-input";
import { DescriptionField } from "@/components/ui/description-field";
import { UTILITY_KINDS, type UtilityKindValue } from "@/components/bills/utility-kind";
import { fetcher } from "@/lib/swr-fetcher";

type Account = { id: string; name: string; kind: string };
type Card = { id: string; name: string };

type BillingCycle =
  | "MONTHLY"
  | "BIMONTHLY"
  | "QUARTERLY"
  | "HALF_YEARLY"
  | "YEARLY";

const CYCLE_OPTIONS: { value: BillingCycle; label: string }[] = [
  { value: "MONTHLY", label: "Every month" },
  { value: "BIMONTHLY", label: "Every 2 months" },
  { value: "QUARTERLY", label: "Every 3 months" },
  { value: "HALF_YEARLY", label: "Every 6 months" },
  { value: "YEARLY", label: "Every year" },
];

type Props = {
  initial?: {
    id: string;
    kind: UtilityKindValue;
    providerName: string;
    connectionNumber: string | null;
    addressLine: string | null;
    accountId: string | null;
    cardId: string | null;
    autoPay: boolean;
    autoPayLeadDays?: number | null;
    defaultDueDay: number | null;
    recurring?: boolean;
    billingCycle?: BillingCycle | null;
    billingDay?: number | null;
    amountMode?: "FIXED" | "VARIABLE" | null;
    defaultAmount?: number | null;
    notes: string | null;
  };
  onSaved: (id: string) => void;
  onCancel: () => void;
};


export function UtilityProviderForm({ initial, onSaved, onCancel }: Props) {
  const isEdit = !!initial;
  const { data: accountsRes } = useSWR<{ accounts: Account[] }>(
    "/api/accounts",
    fetcher,
  );
  const { data: cardsRes } = useSWR<{ cards: Card[] }>("/api/cards", fetcher);
  const [kind, setKind] = useState<UtilityKindValue>(initial?.kind ?? "ELECTRICITY");
  const [providerName, setProviderName] = useState(initial?.providerName ?? "");
  const [connectionNumber, setConnectionNumber] = useState(initial?.connectionNumber ?? "");
  const [addressLine, setAddressLine] = useState(initial?.addressLine ?? "");
  const [sourceMode, setSourceMode] = useState<"none" | "account" | "card">(
    initial?.cardId ? "card" : initial?.accountId ? "account" : "none",
  );
  const [accountId, setAccountId] = useState(initial?.accountId ?? "");
  const [cardId, setCardId] = useState(initial?.cardId ?? "");
  const [autoPay, setAutoPay] = useState(initial?.autoPay ?? false);
  const [autoPayLeadDays, setAutoPayLeadDays] = useState(
    initial?.autoPayLeadDays?.toString() ?? "0",
  );
  const [defaultDueDay, setDefaultDueDay] = useState(
    initial?.defaultDueDay?.toString() ?? "",
  );
  // Recurrence — auto-create a bill each cycle.
  const [recurring, setRecurring] = useState(initial?.recurring ?? false);
  const [billingCycle, setBillingCycle] = useState<BillingCycle>(
    initial?.billingCycle ?? "MONTHLY",
  );
  const [billingDay, setBillingDay] = useState(
    initial?.billingDay?.toString() ?? "",
  );
  const [amountMode, setAmountMode] = useState<"FIXED" | "VARIABLE">(
    initial?.amountMode ?? "VARIABLE",
  );
  const [defaultAmount, setDefaultAmount] = useState(
    initial?.defaultAmount != null ? String(initial.defaultAmount) : "",
  );
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
  const effectiveAccountId =
    accountId || (sourceMode === "account" ? accountOptions[0]?.value ?? "" : "");
  const effectiveCardId =
    cardId || (sourceMode === "card" ? cardOptions[0]?.value ?? "" : "");

  async function submit() {
    setError(null);
    if (!providerName.trim()) return setError("Provider name is required");
    if (recurring && amountMode === "FIXED") {
      const amt = Number(defaultAmount);
      if (!amt || amt <= 0)
        return setError("Set a monthly amount for a fixed recurring bill");
    }
    setSubmitting(true);
    try {
      const payload = {
        kind,
        providerName: providerName.trim(),
        connectionNumber: connectionNumber.trim() || null,
        addressLine: addressLine.trim() || null,
        accountId: sourceMode === "account" ? effectiveAccountId || null : null,
        cardId: sourceMode === "card" ? effectiveCardId || null : null,
        autoPay,
        autoPayLeadDays: autoPay ? Number(autoPayLeadDays) || 0 : 0,
        defaultDueDay: defaultDueDay ? Number(defaultDueDay) : null,
        recurring,
        billingCycle,
        billingDay: recurring && billingDay ? Number(billingDay) : null,
        amountMode,
        defaultAmount: defaultAmount ? Number(defaultAmount) : null,
        notes: notes.trim() || null,
      };
      const res = await fetch(
        isEdit
          ? `/api/utility-providers/${initial!.id}`
          : "/api/utility-providers",
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
      onSaved(isEdit ? initial!.id : body.id);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label>Kind</Label>
          <NativeSelect
            value={kind}
            onChange={(v) => setKind(v as UtilityKindValue)}
            options={UTILITY_KINDS.map((u) => ({ value: u.value, label: u.label }))}
          />
        </div>
        <div>
          <Label>Provider name</Label>
          <Input
            value={providerName}
            onChange={(e) => setProviderName(e.target.value)}
            placeholder="TNEB, ACT Fibernet, Jio…"
            maxLength={120}
          />
        </div>
        <div>
          <Label>Connection / consumer number</Label>
          <Input
            value={connectionNumber}
            onChange={(e) => setConnectionNumber(e.target.value)}
            maxLength={80}
            placeholder="Optional"
          />
        </div>
        <div>
          <Label>Default due day (1–31)</Label>
          <Input
            value={defaultDueDay}
            onChange={(e) => setDefaultDueDay(e.target.value.replace(/\D/g, "").slice(0, 2))}
            placeholder="Optional"
          />
        </div>
        <div className="sm:col-span-2">
          <DescriptionField
            value={addressLine}
            onChange={setAddressLine}
            label="Address (optional)"
            maxLength={240}
            placeholder="Service address — useful when one home has multiple meters"
            rows={2}
          />
        </div>
      </div>

      <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
        <div className="text-xs font-medium">Default payment source</div>
        <div className="flex gap-2 text-xs">
          {(["none", "account", "card"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setSourceMode(m)}
              className={`rounded-md border px-3 py-1.5 capitalize ${
                sourceMode === m ? "bg-foreground text-background" : "bg-background"
              }`}
            >
              {m === "none" ? "No default" : m}
            </button>
          ))}
        </div>
        {sourceMode === "account" && (
          <NativeSelect
            value={effectiveAccountId}
            onChange={setAccountId}
            options={accountOptions}
            placeholder="Select account"
          />
        )}
        {sourceMode === "card" && (
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
          Auto-pay bills from this source when they&apos;re due
        </label>
        {autoPay && (
          <div className="flex items-center gap-2 pl-6 text-xs">
            <span className="text-muted-foreground">Pay</span>
            <Input
              value={autoPayLeadDays}
              onChange={(e) =>
                setAutoPayLeadDays(e.target.value.replace(/\D/g, "").slice(0, 2))
              }
              className="h-7 w-14 text-center"
              placeholder="0"
            />
            <span className="text-muted-foreground">
              day(s) before the due date (0 = on the due date)
            </span>
          </div>
        )}
      </div>

      {/* Recurrence — auto-create a fresh bill each cycle. */}
      <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
        <label className="flex items-center gap-2 text-xs font-medium">
          <input
            type="checkbox"
            checked={recurring}
            onChange={(e) => setRecurring(e.target.checked)}
          />
          Auto-create this bill on a schedule
        </label>
        <p className="pl-6 text-[11px] text-muted-foreground">
          A new bill is added for you each cycle — no more entering it by
          hand.
        </p>
        {recurring && (
          <div className="space-y-3 pl-6">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label>Repeats</Label>
                <NativeSelect
                  value={billingCycle}
                  onChange={(v) => setBillingCycle(v as BillingCycle)}
                  options={CYCLE_OPTIONS}
                />
              </div>
              <div>
                <Label>Bill day (1–31)</Label>
                <Input
                  value={billingDay}
                  onChange={(e) =>
                    setBillingDay(e.target.value.replace(/\D/g, "").slice(0, 2))
                  }
                  placeholder="Day the bill is generated"
                />
              </div>
            </div>
            <div>
              <Label>Amount</Label>
              <div className="mt-1 flex gap-2 text-xs">
                {(
                  [
                    ["FIXED", "Fixed each cycle"],
                    ["VARIABLE", "Varies (I'll confirm)"],
                  ] as const
                ).map(([m, lbl]) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setAmountMode(m)}
                    className={`rounded-md border px-3 py-1.5 ${
                      amountMode === m
                        ? "bg-foreground text-background"
                        : "bg-background"
                    }`}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label>
                {amountMode === "FIXED"
                  ? "Amount each cycle"
                  : "Estimated amount (optional)"}
              </Label>
              <AmountInput
                value={defaultAmount}
                onChange={setDefaultAmount}
                placeholder="0"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                {amountMode === "FIXED"
                  ? "Fixed bills are auto-paid at this amount when auto-pay is on."
                  : "Each generated bill waits for you to enter the real amount before it can be paid."}
              </p>
            </div>
          </div>
        )}
      </div>

      <DescriptionField
        value={notes}
        onChange={setNotes}
        label="Notes"
        maxLength={1000}
        placeholder="Optional"
      />

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={submitting}>
          {submitting ? "Saving…" : isEdit ? "Save changes" : "Add provider"}
        </Button>
      </div>
    </div>
  );
}
