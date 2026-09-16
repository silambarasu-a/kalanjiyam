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

const KIND_OPTIONS = [
  { value: "PURCHASE", label: "Bought from a jeweller" },
  { value: "GIFT_RECEIVED", label: "Gifted to me" },
  { value: "OPENING_STOCK", label: "Already owned / inherited" },
];

type Kind = "PURCHASE" | "GIFT_RECEIVED" | "OPENING_STOCK";

type GoldBillPayload = {
  acquisition: {
    kind: Kind;
    sellerName: string | null;
    billNumber: string | null;
    billTotal: number | null;
    acquiredAt: string;
    notes: string | null;
    investmentName: string | null;
    giftedByContact: { id: string; name: string } | null;
  };
  /** The API's serialised rows, read once to seed the form's own
   *  string-based state. */
  ornaments: Array<{
    id: string;
    name: string;
    itemType: string | null;
    quantity: number;
    purity: string | null;
    grossWeightGrams: number;
    ratePerGram: number;
    stones:
      | Array<{
          kind?: string | null;
          weight?: number;
          carats?: number | null;
          ratePerCt?: number | null;
          charge?: number;
        }>
      | null;
    wastageInput: string | null;
    wastageMode: string | null;
    makingInput: string | null;
    makingMode: string | null;
    cgstInput: string | null;
    cgstMode: string | null;
    sgstInput: string | null;
    sgstMode: string | null;
    roundOff: number;
    costBasis: number;
    declaredValue: number | null;
    assignedContact: { id: string; name: string } | null;
    boughtForContact: { id: string; name: string } | null;
    notes: string | null;
  }>;
  exchanges?: Array<{
    ornamentId: string | null;
    name: string;
    grossWeightGrams: number;
    purity: string | null;
    ratePerGram: number;
    deductionPercent: number | null;
    creditAmount: number;
    assumedCostBasis: number;
    notes: string | null;
  }>;
  tenderRows?: Array<{
    accountId: string | null;
    cardId: string | null;
    contactId: string | null;
    amount: number;
    repay: boolean;
    towardTheirOwn: boolean;
  }>;
};

/**
 * One acquisition event: a jeweller bill with several ornaments on it, a
 * gift, or already-owned gold being recorded for the first time.
 *
 * The bill's files are uploaded against a client-minted UUID before the
 * row exists, and that same UUID becomes the acquisition's id — so one
 * invoice ends up visible from every ornament on it, and a double submit
 * collides on the primary key instead of creating a second bill.
 */
export function GoldAcquisitionForm({ billId }: { billId?: string } = {}) {
  const isEditing = !!billId;
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
    { source: "", amount: "", repay: true, towardTheirOwn: true },
  ]);
  const [exchanges, setExchanges] = useState<ExchangeRow[]>([]);
  // Until the user types an amount themselves, the single payment row
  // follows the balance due. Without this, entering payments and THEN
  // adding a trade-in silently leaves the row overstated by the credit.
  const [tenderEdited, setTenderEdited] = useState(false);
  const [saving, setSaving] = useState(false);

  // Edit mode: everything typed originally comes back, including the
  // payment rows — which is why they're persisted rather than inferred.
  const { data: bill } = useSWR<GoldBillPayload>(
    billId ? `/api/gold/acquisitions/${billId}` : null,
    fetcher,
  );
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (!bill || hydrated) return;
    const a = bill.acquisition;
    /* eslint-disable react-hooks/set-state-in-effect -- one-shot hydration
       from the fetched bill; `hydrated` stops it re-running */
    setKind(a.kind);
    setName(a.investmentName ?? a.sellerName ?? "");
    setSellerName(a.sellerName ?? "");
    setBillNumber(a.billNumber ?? "");
    setBillTotal(a.billTotal != null ? String(a.billTotal) : "");
    setAcquiredAt(a.acquiredAt.slice(0, 10));
    setGiftedByContactId(a.giftedByContact?.id ?? "");
    setNotes(a.notes ?? "");
    setOrnaments(
      bill.ornaments.map((o) => ({
        id: o.id,
        name: o.name,
        itemType: o.itemType ?? "",
        quantity: String(o.quantity),
        purity: o.purity ?? "22K",
        grossWeightGrams: String(o.grossWeightGrams),
        ratePerGram: String(o.ratePerGram),
        stones: (o.stones ?? []).map((st) => ({
          kind: st.kind ?? "",
          weight: String(st.weight ?? ""),
          carats: st.carats != null ? String(st.carats) : "",
          ratePerCt: st.ratePerCt != null ? String(st.ratePerCt) : "",
          charge: String(st.charge ?? ""),
        })),
        wastageInput: o.wastageInput ?? "",
        wastageMode: (o.wastageMode as "PERCENT" | "RUPEE") ?? "PERCENT",
        makingInput: o.makingInput ?? "",
        makingMode: (o.makingMode as "PERCENT" | "RUPEE") ?? "PERCENT",
        cgstInput: o.cgstInput ?? "",
        cgstMode: (o.cgstMode as "PERCENT" | "RUPEE") ?? "PERCENT",
        sgstInput: o.sgstInput ?? "",
        sgstMode: (o.sgstMode as "PERCENT" | "RUPEE") ?? "PERCENT",
        roundOff: o.roundOff ? String(o.roundOff) : "",
        assignedContactId: o.assignedContact?.id ?? "",
        boughtForContactId: o.boughtForContact?.id ?? "",
        declaredValue: o.declaredValue != null ? String(o.declaredValue) : "",
        openingCostBasis: o.costBasis ? String(o.costBasis) : "",
        notes: o.notes ?? "",
      })),
    );
    setExchanges(
      (bill.exchanges ?? []).map((e) => ({
        ornamentId: e.ornamentId ?? "",
        name: e.name,
        grossWeightGrams: String(e.grossWeightGrams),
        purity: e.purity ?? "22K",
        ratePerGram: String(e.ratePerGram),
        deductionPercent:
          e.deductionPercent != null ? String(e.deductionPercent) : "",
        creditAmount: String(e.creditAmount),
        assumedCostBasis: e.assumedCostBasis
          ? String(e.assumedCostBasis)
          : "",
        notes: e.notes ?? "",
      })),
    );
    const rows = bill.tenderRows ?? [];
    setSplits(
      rows.length
        ? rows.map((r) => ({
            source: r.accountId
              ? `account:${r.accountId}`
              : r.cardId
                ? `card:${r.cardId}`
                : r.contactId
                  ? `contact:${r.contactId}`
                  : "",
            amount: String(r.amount),
            repay: r.repay,
            towardTheirOwn: r.towardTheirOwn,
          }))
        : [{ source: "", amount: "", repay: true, towardTheirOwn: true }],
    );
    // Rows came from the record, so they're already correct — don't let
    // the auto-fill effect rewrite them.
    setTenderEdited(true);
    setExpanded(null);
    setHydrated(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [bill, hydrated]);

  // Contacts feed the "gifted by" picker and the per-ornament editors; the
  // payment rows fetch their own accounts / cards / contacts.
  const { data: contactData } = useSWR<{ members: Contact[] }>(
    "/api/contacts",
    fetcher,
  );
  const contacts = useMemo(() => contactData?.members ?? [], [contactData]);

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
  // The payment rows fund the WHOLE bill — pieces you keep and pieces
  // bought for someone else alike, since the shop was paid once. The
  // old-gold credit is tender, not a discount, so it comes off here
  // while the ornaments above keep their full value.
  const cashDue = round2(grandTotal - exchangeCredit);

  useEffect(() => {
    if (tenderEdited || kind !== "PURCHASE" || splits.length !== 1) return;
    const want = cashDue > 0 ? String(cashDue) : "";
    if (splits[0].amount === want) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- payment row tracks the derived balance until hand-edited
    setSplits([{ ...splits[0], amount: want }]);
  }, [cashDue, kind, splits, tenderEdited]);

  function splitSource(v: string): {
    accountId?: string;
    cardId?: string;
    contactId?: string;
  } {
    if (v.startsWith("account:")) return { accountId: v.slice(8) };
    if (v.startsWith("card:")) return { cardId: v.slice(5) };
    if (v.startsWith("contact:")) return { contactId: v.slice(8) };
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
      const res = await fetch(
        isEditing ? `/api/gold/acquisitions/${billId}` : "/api/gold/acquisitions",
        {
        method: isEditing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(isEditing ? {} : { clientId: acquisitionId }),
          kind,
          name: name.trim(),
          sellerName: sellerName.trim() || null,
          billNumber: billNumber.trim() || null,
          billTotal: billTotal ? Number(billTotal) : null,
          acquiredAt,
          giftedByContactId: giftedByContactId || null,
          notes: notes.trim() || null,
          ornaments: ornaments.map((o, i) => ({
            ...(o.id ? { id: o.id } : {}),
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
                    repay: s.source.startsWith("contact:") ? s.repay : false,
                    towardTheirOwn:
                      s.source.startsWith("contact:") && s.towardTheirOwn,
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
        },
      );
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? "Couldn't save this bill");
        return;
      }
      toast.success(isEditing ? "Bill updated" : "Gold bill saved");
      router.push(isEditing ? `/investments/gold/bills/${billId}` : "/investments/gold");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function cancel() {
    if (!isEditing) await uploaderRef.current?.discardAll();
    router.push(isEditing ? `/investments/gold/bills/${billId}` : "/investments/gold");
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
              <span className="tabular-nums">{formatINR(cashDue)}</span>
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

      {kind === "PURCHASE" && grandTotal > 0 && (
        <GoldTenderSplits
          splits={splits}
          onChange={(next) => {
            setTenderEdited(true);
            setSplits(next);
          }}
          target={cashDue}
          beneficiaryIds={ornaments
            .map((o) => o.boughtForContactId)
            .filter(Boolean)}
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
          {isEditing ? "Save changes" : "Save bill"}
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
