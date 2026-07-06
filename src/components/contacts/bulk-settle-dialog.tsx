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
  origin: { id: string; description: string; date: string } | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string;
  contactName: string;
  charges: Charge[];
  direction: "OWED_TO_USER" | "USER_OWES";
  onSaved: () => void;
};


function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function BulkSettleDialog({
  open,
  onOpenChange,
  contactId,
  contactName,
  charges,
  direction,
  onSaved,
}: Props) {
  const isIncoming = direction !== "USER_OWES";
  // Per-line state: a Map keyed by chargeId. Each entry holds whether
  // the charge is selected and the partial amount (as a string, so we
  // can show empty / partial input mid-typing).
  const [lines, setLines] = useState<
    Record<string, { selected: boolean; amount: string }>
  >(() => {
    const out: Record<string, { selected: boolean; amount: string }> = {};
    for (const c of charges) {
      const remaining = Math.max(0, c.amount - c.settledAmount);
      out[c.id] = { selected: true, amount: String(remaining) };
    }
    return out;
  });
  const [paidAt, setPaidAt] = useState(todayIso());
  const [notes, setNotes] = useState("");
  const [sourceMode, setSourceMode] = useState<"account" | "card">("account");
  const [accountId, setAccountId] = useState("");
  const [cardId, setCardId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: accountsRes } = useSWR<{
    accounts: { id: string; name: string; kind: string }[];
  }>(open ? "/api/accounts" : null, fetcher);
  const { data: cardsRes } = useSWR<{ cards: { id: string; name: string }[] }>(
    open ? "/api/cards" : null,
    fetcher,
  );

  const total = useMemo(() => {
    let sum = 0;
    for (const c of charges) {
      const l = lines[c.id];
      if (!l || !l.selected) continue;
      const n = Number(l.amount);
      if (Number.isFinite(n) && n > 0) sum += n;
    }
    return Math.round(sum * 100) / 100;
  }, [charges, lines]);

  const selectedCount = useMemo(
    () => Object.values(lines).filter((l) => l.selected).length,
    [lines],
  );

  function toggle(chargeId: string) {
    setLines((prev) => ({
      ...prev,
      [chargeId]: { ...prev[chargeId], selected: !prev[chargeId].selected },
    }));
  }
  function setAmount(chargeId: string, value: string) {
    setLines((prev) => ({
      ...prev,
      [chargeId]: { ...prev[chargeId], amount: value },
    }));
  }

  async function submit() {
    setError(null);
    if (selectedCount === 0) {
      setError("Pick at least one charge");
      return;
    }
    if (total <= 0) {
      setError("Enter a positive amount");
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        lines: charges
          .filter((c) => lines[c.id]?.selected)
          .map((c) => ({
            chargeId: c.id,
            amount: Number(lines[c.id].amount),
          }))
          .filter((l) => l.amount > 0),
        accountId:
          sourceMode === "account" && accountId ? accountId : null,
        cardId: sourceMode === "card" && cardId ? cardId : null,
        paidAt,
        notes: notes.trim() || null,
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
    ? `Receive settlement from ${contactName}`
    : `Pay ${contactName}`;
  const sourceLabel = isIncoming ? "Receive into" : "Pay from";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(42rem,calc(100%-2rem))]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <p className="text-xs text-muted-foreground">
            {isIncoming
              ? "Pick which charges to clear. Partial amounts are fine — the rest stays outstanding."
              : "Pick which obligations to pay down. Partial amounts are fine — the rest stays outstanding."}
          </p>

          <div className="max-h-72 overflow-auto rounded-md border bg-card">
            <table className="w-full min-w-[26rem] text-sm">
              <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium">
                    <span className="sr-only">Select</span>
                  </th>
                  <th className="px-2 py-1.5 text-left font-medium">Charge</th>
                  <th className="px-2 py-1.5 text-right font-medium">Outstanding</th>
                  <th className="px-2 py-1.5 text-right font-medium">Pay now</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {charges.map((c) => {
                  const remaining = Math.max(0, c.amount - c.settledAmount);
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
                        <div className="font-medium truncate max-w-[220px]">
                          {c.origin?.description ??
                            c.notes ??
                            (c.direction === "USER_OWES"
                              ? "Owed via transfer"
                              : "Recoverable charge")}
                        </div>
                        {c.origin && (
                          <div className="text-[10px] text-muted-foreground">
                            {new Date(c.origin.date).toLocaleDateString(
                              "en-IN",
                              {
                                day: "2-digit",
                                month: "short",
                                year: "numeric",
                              },
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {formatINR(remaining)}
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
              </tbody>
            </table>
          </div>

          <div className="rounded-md border bg-card p-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Selected</span>
              <span>{selectedCount} charge{selectedCount === 1 ? "" : "s"}</span>
            </div>
            <div className="mt-1 flex items-center justify-between border-t pt-1">
              <span className="font-medium">Total {isIncoming ? "received" : "paid"}</span>
              <span className="font-semibold tabular-nums">{formatINR(total)}</span>
            </div>
          </div>

          <div className="space-y-2 rounded-md border bg-muted/30 p-3">
            <div className="text-xs font-medium">{sourceLabel}</div>
            <div className="flex gap-2 text-xs">
              <button
                type="button"
                onClick={() => setSourceMode("account")}
                className={`rounded-md border px-3 py-1.5 ${
                  sourceMode === "account"
                    ? "bg-foreground text-background"
                    : "bg-background"
                }`}
              >
                Account
              </button>
              <button
                type="button"
                onClick={() => setSourceMode("card")}
                className={`rounded-md border px-3 py-1.5 ${
                  sourceMode === "card"
                    ? "bg-foreground text-background"
                    : "bg-background"
                }`}
              >
                Card
              </button>
            </div>
            {sourceMode === "account" ? (
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
            ) : (
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
              Leave blank to record settlement without a cash-flow transaction
              (audit-only).
            </p>
          </div>

          <div>
            <Label>Paid on</Label>
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
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting
              ? "Settling…"
              : isIncoming
                ? `Receive ${formatINR(total)}`
                : `Pay ${formatINR(total)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
