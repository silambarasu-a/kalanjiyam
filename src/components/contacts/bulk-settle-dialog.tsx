"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AmountInput } from "@/components/ui/amount-input";
import { DateInput } from "@/components/ui/date-input";
import { NativeSelect } from "@/components/ui/native-select";
import { Label } from "@/components/ui/label";
import { DescriptionField } from "@/components/ui/description-field";
import { formatINR } from "@/lib/utils";
import { fetcher } from "@/lib/swr-fetcher";

type Charge = {
  id: string;
  amount: number;
  settledAmount: number;
  direction: "OWED_TO_USER" | "USER_OWES";
  status: string;
  notes: string | null;
  createdAt: string;
  origin: { id: string; description: string; date: string } | null;
};

type LeftoverKind = "OBLIGATION" | "GIFT" | "ADVANCE";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string;
  contactName: string;
  charges: Charge[];
  direction: "OWED_TO_USER" | "USER_OWES";
  /** Credit already sitting with the other party, available to apply
   *  instead of cash. Held credit clears what they owe; paid credit
   *  clears what we owe. */
  advanceAvailable?: number;
  onSaved: () => void;
};

type Line = { selected: boolean; amount: string };
type SourceMode = "account" | "card" | "advance";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const remainingOf = (c: Charge) => round2(Math.max(0, c.amount - c.settledAmount));

/** Oldest first — a payment clears the longest-standing debt first. */
function chargeTime(c: Charge) {
  return new Date(c.origin?.date ?? c.createdAt).getTime();
}

export function BulkSettleDialog({
  open,
  onOpenChange,
  contactId,
  contactName,
  charges,
  direction,
  advanceAvailable = 0,
  onSaved,
}: Props) {
  const isIncoming = direction !== "USER_OWES";

  // Only rows with something left to pay can take an allocation; a settled
  // row would just earn a 400 from the server.
  const payable = useMemo(
    () =>
      charges.filter((c) => remainingOf(c) > 0.005).sort((a, b) => chargeTime(a) - chargeTime(b)),
    [charges],
  );
  const totalOutstanding = useMemo(
    () => round2(payable.reduce((s, c) => s + remainingOf(c), 0)),
    [payable],
  );

  // The parent unmounts this dialog when it closes, so plain initialisers
  // give us a clean slate every time it opens — no reset effect needed.
  const [received, setReceived] = useState(() =>
    totalOutstanding > 0 ? String(totalOutstanding) : "",
  );
  // null = the rows follow the amount. Editing any row takes over.
  const [manualLines, setManualLines] = useState<Record<string, Line> | null>(
    null,
  );
  const [paidAt, setPaidAt] = useState(todayIso());
  const [notes, setNotes] = useState("");
  const [sourceMode, setSourceMode] = useState<SourceMode>("account");
  const [accountId, setAccountId] = useState("");
  const [cardId, setCardId] = useState("");
  const [leftoverKind, setLeftoverKind] = useState<LeftoverKind | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: accountsRes } = useSWR<{
    accounts: { id: string; name: string; kind: string }[];
  }>(open ? "/api/accounts" : null, fetcher);
  const { data: cardsRes } = useSWR<{ cards: { id: string; name: string }[] }>(
    open ? "/api/cards" : null,
    fetcher,
  );

  const receivedNum = useMemo(() => {
    const n = Number(received);
    return Number.isFinite(n) ? round2(n) : 0;
  }, [received]);

  /** The amount spread across the payable charges, oldest first. Derived,
   *  so typing a new amount re-spreads it with no effect in the loop. */
  const autoLines = useMemo(() => {
    let left = receivedNum;
    const out: Record<string, Line> = {};
    for (const c of payable) {
      const take = round2(Math.min(remainingOf(c), Math.max(0, left)));
      left = round2(left - take);
      out[c.id] = {
        selected: take > 0.005,
        amount: take > 0 ? String(take) : "",
      };
    }
    return out;
  }, [payable, receivedNum]);

  const lines = manualLines ?? autoLines;

  const allocated = useMemo(() => {
    let sum = 0;
    for (const c of payable) {
      const l = lines[c.id];
      if (!l?.selected) continue;
      const n = Number(l.amount);
      if (Number.isFinite(n) && n > 0) sum += n;
    }
    return round2(sum);
  }, [payable, lines]);

  const isAdvanceMode = sourceMode === "advance";
  const leftover = round2(receivedNum - allocated);
  const overAllocated = leftover < -0.005;
  const hasLeftover = leftover > 0.005;
  const selectedCount = payable.filter((c) => lines[c.id]?.selected).length;

  // Both handlers freeze the current derived allocation into state first,
  // so taking over one row doesn't discard what the others were showing.
  function toggle(chargeId: string) {
    setManualLines((prev) => {
      const base = prev ?? autoLines;
      return {
        ...base,
        [chargeId]: {
          selected: !base[chargeId]?.selected,
          amount: base[chargeId]?.amount ?? "",
        },
      };
    });
  }
  function setAmount(chargeId: string, value: string) {
    setManualLines((prev) => {
      const base = prev ?? autoLines;
      return {
        ...base,
        [chargeId]: { selected: base[chargeId]?.selected ?? true, amount: value },
      };
    });
  }

  // Direction decides who ends up owing whom for the surplus.
  const leftoverOptions: { kind: LeftoverKind; label: string; hint: string }[] = [
    {
      kind: "OBLIGATION",
      label: isIncoming
        ? `You'll owe ${contactName} ${formatINR(leftover)}`
        : `${contactName} will owe you ${formatINR(leftover)}`,
      hint: "Recorded as a new obligation you can settle later",
    },
    {
      kind: "GIFT",
      label: "Gift — nothing owed",
      hint: isIncoming
        ? "Recorded as income from them"
        : "Recorded as money spent on them",
    },
    {
      kind: "ADVANCE",
      label: "Hold as advance credit",
      hint: isIncoming
        ? "Kept against their future charges"
        : "Credit sitting with them for your future dues",
    },
  ];

  const disabledReason = (() => {
    if (selectedCount === 0) return "Pick at least one charge";
    if (allocated <= 0) return "Enter an amount to allocate";
    if (overAllocated)
      return `Allocated ${formatINR(allocated)} but only ${formatINR(receivedNum)} ${
        isIncoming ? "received" : "paid"
      }`;
    if (isAdvanceMode) {
      if (hasLeftover)
        return "Advance credit can only cover the charges — reduce the amount";
      if (allocated > advanceAvailable + 0.005)
        return `Only ${formatINR(advanceAvailable)} of advance credit available`;
      return null;
    }
    if (hasLeftover) {
      if (!leftoverKind) return "Say what the leftover is";
      if (sourceMode === "card")
        return "Pick a bank or cash account to record the leftover";
      if (!accountId) return "Pick an account to record the leftover";
    }
    return null;
  })();

  async function submit() {
    setError(null);
    if (disabledReason) {
      setError(disabledReason);
      return;
    }
    setSubmitting(true);
    try {
      const payloadLines = payable
        .filter((c) => lines[c.id]?.selected)
        .map((c) => ({ chargeId: c.id, amount: Number(lines[c.id].amount) }))
        .filter((l) => Number.isFinite(l.amount) && l.amount > 0);

      const payload = isAdvanceMode
        ? {
            lines: payloadLines,
            paidAt,
            notes: notes.trim() || null,
            fundedFromAdvance: true as const,
          }
        : {
            lines: payloadLines,
            accountId: sourceMode === "account" && accountId ? accountId : null,
            cardId: sourceMode === "card" && cardId ? cardId : null,
            paidAt,
            notes: notes.trim() || null,
            receivedAmount: receivedNum,
            ...(hasLeftover && leftoverKind
              ? { leftover: { amount: leftover, kind: leftoverKind } }
              : {}),
          };

      const res = await fetch(`/api/contacts/${contactId}/settle`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Settle failed");
        return;
      }
      onOpenChange(false);
      onSaved();
    } finally {
      setSubmitting(false);
    }
  }

  const title = isIncoming
    ? `Receive from ${contactName}`
    : `Pay ${contactName}`;
  const amountLabel = isAdvanceMode
    ? "Credit to apply"
    : isIncoming
      ? "Amount received"
      : "Amount paid";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(44rem,calc(100%-2rem))]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div className="rounded-md border bg-muted/30 p-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[10rem] flex-1">
                <Label>{amountLabel}</Label>
                <AmountInput value={received} onChange={setReceived} />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setManualLines(null)}
                disabled={manualLines === null}
              >
                Auto-allocate
              </Button>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Spread across the oldest charges first. Edit any row to take over,
              then hit Auto-allocate to start again.
            </p>
          </div>

          <div className="max-h-64 overflow-auto rounded-md border bg-card">
            <table className="w-full min-w-[26rem] text-sm">
              <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium">
                    <span className="sr-only">Select</span>
                  </th>
                  <th className="px-2 py-1.5 text-left font-medium">Charge</th>
                  <th className="px-2 py-1.5 text-right font-medium">
                    Outstanding
                  </th>
                  <th className="px-2 py-1.5 text-right font-medium">
                    {isIncoming ? "Clear now" : "Pay now"}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {payable.map((c) => {
                  const l = lines[c.id];
                  return (
                    <tr key={c.id} className="hover:bg-muted/30">
                      <td className="px-2 py-1.5">
                        <input
                          type="checkbox"
                          checked={l?.selected ?? false}
                          onChange={() => toggle(c.id)}
                          className="h-4 w-4 accent-primary"
                        />
                      </td>
                      <td className="px-2 py-1.5 text-xs">
                        <div className="max-w-[220px] truncate font-medium">
                          {c.origin?.description ??
                            c.notes ??
                            (c.direction === "USER_OWES"
                              ? "Owed via transfer"
                              : "Recoverable charge")}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {new Date(c.origin?.date ?? c.createdAt).toLocaleDateString(
                            "en-IN",
                            { day: "2-digit", month: "short", year: "numeric" },
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {formatINR(remainingOf(c))}
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="ml-auto w-28">
                          <AmountInput
                            value={l?.amount ?? ""}
                            onChange={(v) => setAmount(c.id, v)}
                            disabled={!l?.selected}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {payable.length === 0 && (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-3 py-6 text-center text-xs text-muted-foreground"
                    >
                      Nothing outstanding to settle.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="rounded-md border bg-card p-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">
                Allocated across {selectedCount} charge
                {selectedCount === 1 ? "" : "s"}
              </span>
              <span className="tabular-nums">{formatINR(allocated)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between border-t pt-1">
              <span className="font-medium">
                {overAllocated ? "Over-allocated by" : "Leftover"}
              </span>
              <span
                className={`font-semibold tabular-nums ${
                  overAllocated
                    ? "text-destructive"
                    : hasLeftover
                      ? "text-amber-600 dark:text-amber-500"
                      : ""
                }`}
              >
                {formatINR(Math.abs(leftover))}
              </span>
            </div>
          </div>

          {hasLeftover && !isAdvanceMode && (
            <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
              <div className="text-xs font-medium">
                {formatINR(leftover)} left over — what is it?
              </div>
              <div className="space-y-1.5">
                {leftoverOptions.map((opt) => (
                  <label
                    key={opt.kind}
                    className={`flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2 text-xs ${
                      leftoverKind === opt.kind
                        ? "border-foreground bg-background"
                        : "border-transparent bg-background/60 hover:bg-background"
                    }`}
                  >
                    <input
                      type="radio"
                      name="leftover-kind"
                      className="mt-0.5 h-3.5 w-3.5 accent-primary"
                      checked={leftoverKind === opt.kind}
                      onChange={() => setLeftoverKind(opt.kind)}
                    />
                    <span>
                      <span className="block font-medium">{opt.label}</span>
                      <span className="block text-[10px] text-muted-foreground">
                        {opt.hint}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2 rounded-md border bg-muted/30 p-3">
            <div className="text-xs font-medium">
              {isIncoming ? "Receive into" : "Pay from"}
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              {(
                [
                  { mode: "account" as const, label: "Account", show: true },
                  { mode: "card" as const, label: "Card", show: true },
                  {
                    mode: "advance" as const,
                    label: `Advance credit (${formatINR(advanceAvailable)})`,
                    show: advanceAvailable > 0.005,
                  },
                ] as const
              )
                .filter((o) => o.show)
                .map((o) => (
                  <button
                    key={o.mode}
                    type="button"
                    onClick={() => setSourceMode(o.mode)}
                    className={`rounded-md border px-3 py-1.5 ${
                      sourceMode === o.mode
                        ? "bg-foreground text-background"
                        : "bg-background"
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
            </div>
            {sourceMode === "account" && (
              <NativeSelect
                value={accountId}
                onChange={setAccountId}
                options={(accountsRes?.accounts ?? []).map((a) => ({
                  value: a.id,
                  label: a.name,
                  hint: a.kind,
                }))}
                placeholder="Select account (optional)"
              />
            )}
            {sourceMode === "card" && (
              <NativeSelect
                value={cardId}
                onChange={setCardId}
                options={(cardsRes?.cards ?? []).map((c) => ({
                  value: c.id,
                  label: c.name,
                }))}
                placeholder="Select card (optional)"
              />
            )}
            <p className="text-[10px] text-muted-foreground">
              {isAdvanceMode
                ? "Draws down credit already held. No cash moves and no transaction is recorded."
                : "Leave blank to record settlement without a cash-flow transaction (audit-only)."}
            </p>
          </div>

          <div>
            <Label>{isIncoming ? "Received on" : "Paid on"}</Label>
            <DateInput
              value={paidAt}
              onChange={(e) => setPaidAt(e.target.value)}
            />
          </div>
          <DescriptionField
            value={notes}
            onChange={setNotes}
            label="Notes"
            maxLength={200}
            placeholder="Optional"
          />

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={submitting || !!disabledReason}
            title={disabledReason ?? undefined}
          >
            {submitting
              ? "Settling…"
              : isAdvanceMode
                ? `Apply ${formatINR(allocated)}`
                : isIncoming
                  ? `Receive ${formatINR(receivedNum)}`
                  : `Pay ${formatINR(receivedNum)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
