"use client";

import { useState } from "react";
import useSWR from "swr";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DateInput } from "@/components/ui/date-input";
import { NativeSelect } from "@/components/ui/native-select";
import { AmountInput } from "@/components/ui/amount-input";
import { fetcher } from "@/lib/swr-fetcher";
import { formatINR, cn } from "@/lib/utils";

type Contact = { id: string; name: string };
type Account = { id: string; name: string; kind: string };
type Card = { id: string; name: string };

/**
 * Sell an ornament for cash, or give it away.
 *
 * Both remove the piece from holdings; only a sale realises a gain. A
 * gift deliberately realises nothing — the cost basis just leaves the
 * portfolio, rather than being booked as a loss.
 */
export function GoldDisposeDialog({
  open,
  onOpenChange,
  ornament,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  ornament: { id: string; name: string; costBasis: number };
  onDone: () => void;
}) {
  const [kind, setKind] = useState<"SOLD" | "GIFTED">("SOLD");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [contactId, setContactId] = useState("");
  const [source, setSource] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: contactData } = useSWR<{ members: Contact[] }>(
    open ? "/api/contacts" : null,
    fetcher,
  );
  const { data: accountData } = useSWR<{ accounts: Account[] }>(
    open ? "/api/accounts" : null,
    fetcher,
  );
  const { data: cardData } = useSWR<{ cards: Card[] }>(
    open ? "/api/cards" : null,
    fetcher,
  );

  const sources = [
    ...(accountData?.accounts ?? [])
      .filter((a) => a.kind !== "CARD")
      .map((a) => ({ value: `account:${a.id}`, label: a.name, hint: "Account" })),
    ...(cardData?.cards ?? []).map((c) => ({
      value: `card:${c.id}`,
      label: c.name,
      hint: "Card",
    })),
  ];
  const contacts = contactData?.members ?? [];

  const proceeds = Number(amount) || 0;
  const gain = proceeds - ornament.costBasis;

  async function submit() {
    setSaving(true);
    try {
      const res = await fetch(`/api/gold/ornaments/${ornament.id}/dispose`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          date,
          amount: kind === "SOLD" ? proceeds : null,
          contactId: contactId || null,
          accountId:
            kind === "SOLD" && source.startsWith("account:")
              ? source.slice(8)
              : null,
          cardId:
            kind === "SOLD" && source.startsWith("card:")
              ? source.slice(5)
              : null,
          notes: notes.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? "Couldn't record this");
        return;
      }
      toast.success(kind === "SOLD" ? "Sale recorded" : "Gift recorded");
      onOpenChange(false);
      onDone();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Dispose of {ornament.name}</DialogTitle>
          <DialogDescription>
            This removes the piece from your holdings.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant={kind === "SOLD" ? "default" : "outline"}
              onClick={() => setKind("SOLD")}
            >
              Sold for cash
            </Button>
            <Button
              type="button"
              variant={kind === "GIFTED" ? "default" : "outline"}
              onClick={() => setKind("GIFTED")}
            >
              Gifted away
            </Button>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">Date</Label>
            <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
          </div>

          {kind === "SOLD" ? (
            <>
              <div>
                <Label className="text-xs text-muted-foreground">
                  Sale amount
                </Label>
                <AmountInput value={amount} onChange={setAmount} />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">
                  Money landed in
                </Label>
                <NativeSelect
                  value={source}
                  onChange={setSource}
                  options={sources}
                  placeholder="Account or card"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">
                  Buyer (optional)
                </Label>
                <NativeSelect
                  value={contactId}
                  onChange={setContactId}
                  options={[
                    { value: "", label: "— not a contact —" },
                    ...contacts.map((c) => ({ value: c.id, label: c.name })),
                  ]}
                  searchable
                />
              </div>
              {proceeds > 0 && (
                <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Cost basis</span>
                    <span className="tabular-nums">
                      {formatINR(ornament.costBasis)}
                    </span>
                  </div>
                  <div className="mt-1 flex justify-between font-semibold">
                    <span>Realised {gain >= 0 ? "gain" : "loss"}</span>
                    <span
                      className={cn(
                        "tabular-nums",
                        gain >= 0
                          ? "text-emerald-700 dark:text-emerald-400"
                          : "text-red-700 dark:text-red-400",
                      )}
                    >
                      {gain >= 0 ? "+" : "−"}
                      {formatINR(Math.abs(gain))}
                    </span>
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <div>
                <Label className="text-xs text-muted-foreground">
                  Gifted to
                </Label>
                <NativeSelect
                  value={contactId}
                  onChange={setContactId}
                  options={contacts.map((c) => ({ value: c.id, label: c.name }))}
                  searchable
                  placeholder="Who received it"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                No money moves. The piece leaves your holdings at its cost
                basis of {formatINR(ornament.costBasis)} — a gift realises
                neither gain nor loss.
              </p>
            </>
          )}

          <div>
            <Label className="text-xs text-muted-foreground">Notes</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Exchanged toward a new chain"
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button onClick={submit} disabled={saving} className="gap-2">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Record
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
