"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DateInput } from "@/components/ui/date-input";
import { NativeSelect } from "@/components/ui/native-select";
import { AmountInput } from "@/components/ui/amount-input";
import {
  InstantAttachmentUploader,
  useInstantAttachmentOwnerId,
  type InstantAttachmentUploaderHandle,
} from "@/components/attachments/instant-attachment-uploader";
import {
  OrnamentLineEditor,
  emptyOrnament,
  lineOf,
  type OrnamentRow,
} from "@/components/investments/gold/ornament-line-editor";
import {
  GoldTenderSplits,
  type TenderRow,
} from "@/components/investments/gold/gold-tender-splits";
import {
  GoldExchangeRepeater,
  type ExchangeRow,
} from "@/components/investments/gold/gold-exchange-repeater";
import { fetcher } from "@/lib/swr-fetcher";
import { formatINR } from "@/lib/utils";
import { round2 } from "@/lib/gold";

type Contact = { id: string; name: string };
type Account = { id: string; name: string; kind: string };
type Card = { id: string; name: string };

const KIND_OPTIONS = [
  { value: "PURCHASE", label: "Bought from a jeweller" },
  { value: "GIFT_RECEIVED", label: "Gifted to me" },
  { value: "OPENING_STOCK", label: "Already owned / inherited" },
];

type Kind = "PURCHASE" | "GIFT_RECEIVED" | "OPENING_STOCK";

/**
 * One acquisition event: a jeweller bill with several ornaments on it, a
 * gift, or already-owned gold being recorded for the first time.
 *
 * The bill's files are uploaded against a client-minted UUID before the
 * row exists, and that same UUID becomes the acquisition's id — so one
 * invoice ends up visible from every ornament on it, and a double submit
 * collides on the primary key instead of creating a second bill.
 */
export function GoldAcquisitionForm() {
  const router = useRouter();
  const acquisitionId = useInstantAttachmentOwnerId();
  const uploaderRef = useRef<InstantAttachmentUploaderHandle>(null);

  const [kind, setKind] = useState<Kind>("PURCHASE");
  const [name, setName] = useState("");
  const [sellerName, setSellerName] = useState("");
  const [billNumber, setBillNumber] = useState("");
  const [billTotal, setBillTotal] = useState("");
  const [acquiredAt, setAcquiredAt] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [giftedByContactId, setGiftedByContactId] = useState("");
  const [notes, setNotes] = useState("");
  const [ornaments, setOrnaments] = useState<OrnamentRow[]>([emptyOrnament()]);
  const [expanded, setExpanded] = useState<number | null>(0);
  const [splits, setSplits] = useState<TenderRow[]>([
    { source: "", amount: "" },
  ]);
  const [exchanges, setExchanges] = useState<ExchangeRow[]>([]);
  // Until the user types an amount themselves, the single payment row
  // follows the balance due. Without this, entering payments and THEN
  // adding a trade-in silently leaves the row overstated by the credit.
  const [tenderEdited, setTenderEdited] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data: contactData } = useSWR<{ members: Contact[] }>(
    "/api/contacts",
    fetcher,
  );
  const { data: accountData } = useSWR<{ accounts: Account[] }>(
    "/api/accounts",
    fetcher,
  );
  const { data: cardData } = useSWR<{ cards: Card[] }>("/api/cards", fetcher);

  const contacts = contactData?.members ?? [];
  const sources = useMemo(
    () => [
      // CARD-kind accounts are cards' companion ledgers — the card
      // itself is the thing you spend from, and it's listed below.
      ...(accountData?.accounts ?? [])
        .filter((a) => a.kind !== "CARD")
        .map((a) => ({
          value: `account:${a.id}`,
          label: a.name,
          hint: "Account",
        })),
      ...(cardData?.cards ?? []).map((c) => ({
        value: `card:${c.id}`,
        label: c.name,
        hint: "Card",
      })),
    ],
    [accountData, cardData],
  );

  const lines = ornaments.map(lineOf);
  const ownTotal = round2(
    ornaments.reduce(
      (a, o, i) => (o.boughtForContactId ? a : a + lines[i].lineTotal),
      0,
    ),
  );
  const theirTotal = round2(
    ornaments.reduce(
      (a, o, i) => (o.boughtForContactId ? a + lines[i].lineTotal : a),
      0,
    ),
  );
  const grandTotal = round2(ownTotal + theirTotal);
  const exchangeCredit = round2(
    exchanges.reduce((a, e) => a + (parseFloat(e.creditAmount) || 0), 0),
  );
  // What still has to be paid in cash or card for the pieces you're
  // keeping. The credit is tender, not a discount — the ornaments above
  // keep their full value.
  const cashDue = round2(ownTotal - exchangeCredit);

  useEffect(() => {
    if (tenderEdited || kind !== "PURCHASE" || splits.length !== 1) return;
    const want = cashDue > 0 ? String(cashDue) : "";
    if (splits[0].amount === want) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- payment row tracks the derived balance until hand-edited
    setSplits([{ ...splits[0], amount: want }]);
  }, [cashDue, kind, splits, tenderEdited]);

  function splitSource(v: string): { accountId?: string; cardId?: string } {
    if (v.startsWith("account:")) return { accountId: v.slice(8) };
    if (v.startsWith("card:")) return { cardId: v.slice(5) };
    return {};
  }

  async function submit() {
    if (!name.trim()) {
      toast.error("Give this bill a name");
      return;
    }
    if (ornaments.some((o) => !o.name.trim())) {
      toast.error("Every ornament needs a name");
      return;
    }
    if (kind === "PURCHASE" && ownTotal > 0) {
      const tender = round2(
        splits
          .filter((s) => s.source && parseFloat(s.amount) > 0)
          .reduce((a, s) => a + Number(s.amount), 0),
      );
      const gap = round2(tender - cashDue);
      if (Math.abs(gap) > 0.01) {
        toast.error(
          exchangeCredit > 0
            ? `After the ${formatINR(exchangeCredit)} old-gold credit, ${formatINR(cashDue)} is left to pay — your payment rows total ${formatINR(tender)}.`
            : `Payment rows total ${formatINR(tender)} but ${formatINR(cashDue)} is due.`,
        );
        return;
      }
    }
    setSaving(true);
    try {
      const res = await fetch("/api/gold/acquisitions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: acquisitionId,
          kind,
          name: name.trim(),
          sellerName: sellerName.trim() || null,
          billNumber: billNumber.trim() || null,
          billTotal: billTotal ? Number(billTotal) : null,
          acquiredAt,
          giftedByContactId: giftedByContactId || null,
          notes: notes.trim() || null,
          ornaments: ornaments.map((o, i) => ({
            name: o.name.trim(),
            itemType: o.itemType.trim() || null,
            quantity: Number(o.quantity) || 1,
            purity: o.purity || null,
            grossWeightGrams: Number(o.grossWeightGrams) || 0,
            ratePerGram: Number(o.ratePerGram) || 0,
            stones: o.stones.map((s) => ({
              kind: s.kind || null,
              weight: Number(s.weight) || 0,
              carats: s.carats ? Number(s.carats) : null,
              ratePerCt: s.ratePerCt ? Number(s.ratePerCt) : null,
              charge: Number(s.charge) || 0,
            })),
            wastageInput: o.wastageInput || null,
            wastageMode: o.wastageMode,
            makingInput: o.makingInput || null,
            makingMode: o.makingMode,
            cgstInput: o.cgstInput || null,
            cgstMode: o.cgstMode,
            sgstInput: o.sgstInput || null,
            sgstMode: o.sgstMode,
            roundOff: Number(o.roundOff) || 0,
            lineTotal: lines[i].lineTotal,
            assignedContactId: o.assignedContactId || null,
            boughtForContactId: o.boughtForContactId || null,
            onBehalfAccountId: o.boughtForContactId
              ? (splitSource(o.onBehalfSource).accountId ?? null)
              : null,
            onBehalfCardId: o.boughtForContactId
              ? (splitSource(o.onBehalfSource).cardId ?? null)
              : null,
            declaredValue: o.declaredValue ? Number(o.declaredValue) : null,
            openingCostBasis: o.openingCostBasis
              ? Number(o.openingCostBasis)
              : null,
            notes: o.notes.trim() || null,
          })),
          splits:
            kind === "PURCHASE"
              ? splits
                  .filter((s) => s.source && parseFloat(s.amount) > 0)
                  .map((s) => ({
                    ...splitSource(s.source),
                    amount: Number(s.amount),
                  }))
              : [],
          exchanges:
            kind === "PURCHASE"
              ? exchanges
                  .filter((e) => parseFloat(e.creditAmount) > 0)
                  .map((e) => ({
                    ornamentId: e.ornamentId || null,
                    name: e.name.trim() || "Old gold",
                    grossWeightGrams: Number(e.grossWeightGrams) || 0,
                    purity: e.purity || null,
                    ratePerGram: Number(e.ratePerGram) || 0,
                    deductionPercent: e.deductionPercent
                      ? Number(e.deductionPercent)
                      : null,
                    creditAmount: Number(e.creditAmount),
                    assumedCostBasis:
                      !e.ornamentId && e.assumedCostBasis
                        ? Number(e.assumedCostBasis)
                        : null,
                    notes: e.notes.trim() || null,
                  }))
              : [],
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? "Couldn't save this bill");
        return;
      }
      toast.success("Gold bill saved");
      router.push("/investments/gold");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function cancel() {
    await uploaderRef.current?.discardAll();
    router.push("/investments/gold");
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label className="text-xs text-muted-foreground">How did you get it</Label>
          <NativeSelect
            value={kind}
            onChange={(v) => setKind(v as Kind)}
            options={KIND_OPTIONS}
          />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">
            {kind === "PURCHASE" ? "Bill date" : "Date acquired"}
          </Label>
          <DateInput
            value={acquiredAt}
            onChange={(e) => setAcquiredAt(e.target.value)}
          />
        </div>
        <div className="sm:col-span-2">
          <Label className="text-xs text-muted-foreground">
            Name this entry
          </Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={
              kind === "PURCHASE"
                ? "Saravana Stores · Deepavali bill"
                : "Grandmother's jewellery"
            }
          />
        </div>

        {kind === "PURCHASE" && (
          <>
            <div>
              <Label className="text-xs text-muted-foreground">Jeweller</Label>
              <Input
                value={sellerName}
                onChange={(e) => setSellerName(e.target.value)}
                placeholder="Saravana Stores"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Bill number</Label>
              <Input
                value={billNumber}
                onChange={(e) => setBillNumber(e.target.value)}
                placeholder="JW-2291"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">
                Bill total (optional — checked against the lines)
              </Label>
              <AmountInput value={billTotal} onChange={setBillTotal} />
            </div>
          </>
        )}

        {kind === "GIFT_RECEIVED" && (
          <div>
            <Label className="text-xs text-muted-foreground">Gifted by</Label>
            <NativeSelect
              value={giftedByContactId}
              onChange={setGiftedByContactId}
              options={contacts.map((c) => ({ value: c.id, label: c.name }))}
              searchable
              placeholder="Who gave it to you"
            />
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">Ornaments</h2>
            <p className="text-xs text-muted-foreground">
              One row per physical piece. Each keeps its own weight, purity
              and charges — exactly as the bill prints them.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setOrnaments([
                ...ornaments,
                emptyOrnament(ornaments.at(-1)?.ratePerGram ?? ""),
              ]);
              setExpanded(ornaments.length);
            }}
            className="gap-1"
          >
            <Plus className="h-3.5 w-3.5" /> Add ornament
          </Button>
        </div>

        {ornaments.map((o, i) => (
          <OrnamentLineEditor
            key={i}
            index={i}
            ornament={o}
            onChange={(next) =>
              setOrnaments(ornaments.map((r, idx) => (idx === i ? next : r)))
            }
            onRemove={() => {
              setOrnaments(ornaments.filter((_, idx) => idx !== i));
              setExpanded(null);
            }}
            canRemove={ornaments.length > 1}
            contacts={contacts}
            sources={sources}
            acquisitionKind={kind}
            expanded={expanded === i}
            onToggle={() => setExpanded(expanded === i ? null : i)}
          />
        ))}
      </div>

      <div className="rounded-xl border bg-card p-4 space-y-2 text-sm">
        <Row label="Ornaments you're keeping" value={ownTotal} />
        {theirTotal > 0 && (
          <Row label="Bought for others (they repay you)" value={theirTotal} />
        )}
        <div className="flex items-center justify-between border-t pt-2 font-semibold">
          <span>Bill total</span>
          <span className="tabular-nums">{formatINR(grandTotal)}</span>
        </div>
        {exchangeCredit > 0 && (
          <>
            <div className="flex items-center justify-between text-violet-700 dark:text-violet-400">
              <span>Less old gold exchanged</span>
              <span className="tabular-nums">−{formatINR(exchangeCredit)}</span>
            </div>
            <div className="flex items-center justify-between border-t pt-2 font-semibold">
              <span>To pay now</span>
              <span className="tabular-nums">
                {formatINR(round2(cashDue + theirTotal))}
              </span>
            </div>
          </>
        )}
        {billTotal && Math.abs(Number(billTotal) - grandTotal) > 1 && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            The printed bill says {formatINR(Number(billTotal))} — the lines
            add up to {formatINR(grandTotal)}.
          </p>
        )}
      </div>

      {kind === "PURCHASE" && (
        <GoldExchangeRepeater exchanges={exchanges} onChange={setExchanges} />
      )}

      {kind === "PURCHASE" && ownTotal > 0 && (
        <GoldTenderSplits
          splits={splits}
          onChange={(next) => {
            setTenderEdited(true);
            setSplits(next);
          }}
          sources={sources}
          target={cashDue}
        />
      )}

      <div>
        <Label className="text-sm font-medium">Bill &amp; attachments</Label>
        <p className="mb-2 text-xs text-muted-foreground">
          Uploaded once here, visible from every ornament on this bill.
        </p>
        <InstantAttachmentUploader
          ref={uploaderRef}
          ownerKind="GOLD_BILL"
          ownerId={acquisitionId}
          draft
          accept="application/pdf,image/*"
        />
      </div>

      <div>
        <Label className="text-xs text-muted-foreground">Notes</Label>
        <Input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Exchanged 12g of old gold against this bill"
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={cancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="button" onClick={submit} disabled={saving} className="gap-2">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Save bill
        </Button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{formatINR(value)}</span>
    </div>
  );
}
