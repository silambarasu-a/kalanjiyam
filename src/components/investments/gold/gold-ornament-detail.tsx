"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { ArrowLeft, Gem, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AttachmentList } from "@/components/attachments/attachment-list";
import { GoldBreakdown, type GoldStone } from "@/components/investments/gold-breakdown";
import { GoldDisposeDialog } from "@/components/investments/gold/gold-dispose-dialog";
import { fetcher } from "@/lib/swr-fetcher";
import { formatINR, formatDate, cn } from "@/lib/utils";
import { fineGrams } from "@/lib/gold";

type Detail = {
  ornament: {
    id: string;
    name: string;
    itemType: string | null;
    purity: string | null;
    quantity: number;
    grossWeightGrams: number;
    stoneWeightGrams: number;
    netWeightGrams: number;
    ratePerGram: number;
    wastageAmount: number;
    makingAmount: number;
    cgstAmount: number;
    sgstAmount: number;
    roundOff: number;
    lineTotal: number;
    costBasis: number;
    declaredValue: number | null;
    stones: GoldStone[] | null;
    status: "HELD" | "SOLD" | "GIFTED_OUT" | "EXCHANGED";
    disposedAt: string | null;
    disposalKind: string | null;
    disposalAmount: number | null;
    realisedGain: number | null;
    notes: string | null;
    assignedContact: { id: string; name: string } | null;
    boughtForContact: { id: string; name: string } | null;
    disposalContact: { id: string; name: string } | null;
    memberCharge: {
      id: string;
      amount: number;
      settledAmount: number;
      status: string;
    } | null;
  };
  acquisition: {
    id: string;
    kind: "PURCHASE" | "GIFT_RECEIVED" | "OPENING_STOCK";
    sellerName: string | null;
    billNumber: string | null;
    billTotal: number | null;
    acquiredAt: string;
    notes: string | null;
    investmentId: string | null;
    investmentName: string | null;
    giftedByContact: { id: string; name: string } | null;
  };
  siblings: {
    id: string;
    name: string;
    netWeightGrams: number;
    purity: string | null;
    lineTotal: number;
    status: string;
    isTheirs: boolean;
  }[];
};

export function GoldOrnamentDetail({ ornamentId }: { ornamentId: string }) {
  const router = useRouter();
  const [disposing, setDisposing] = useState(false);
  const { data, isLoading, mutate } = useSWR<Detail>(
    `/api/gold/ornaments/${ornamentId}`,
    fetcher,
  );

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (!data) {
    return <p className="text-sm text-muted-foreground">Not found.</p>;
  }

  const { ornament: o, acquisition: acq, siblings } = data;
  const goldValue =
    o.lineTotal -
    o.wastageAmount -
    o.makingAmount -
    o.cgstAmount -
    o.sgstAmount -
    o.roundOff -
    (o.stones ?? []).reduce((a, s) => a + s.charge, 0);

  return (
    <div className="space-y-5">
      <Link
        href="/investments/gold"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Gold &amp; jewellery
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Gem className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            <h1 className="text-2xl font-semibold tracking-tight">{o.name}</h1>
            {o.purity && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold">
                {o.purity}
              </span>
            )}
            {o.status !== "HELD" && (
              <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                {o.status === "SOLD"
                  ? "Sold"
                  : o.status === "EXCHANGED"
                    ? "Exchanged"
                    : "Gifted away"}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {o.itemType ? `${o.itemType} · ` : ""}
            {o.netWeightGrams}g net ({fineGrams(o.netWeightGrams, o.purity)}g
            fine)
            {o.quantity > 1 ? ` · ${o.quantity} pieces` : ""}
          </p>
        </div>
        {o.status === "HELD" && !o.boughtForContact && (
          <Button variant="outline" onClick={() => setDisposing(true)}>
            Sell or gift away
          </Button>
        )}
      </div>

      {/* Whose it is. Assigned keeps it ours; bought-for makes it theirs
          and shows what's still owed. */}
      {(o.boughtForContact || o.assignedContact || acq.giftedByContact) && (
        <div
          className={cn(
            "rounded-xl border p-4 text-sm",
            o.boughtForContact
              ? "border-amber-400/60 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-950/30"
              : "bg-card",
          )}
        >
          {o.boughtForContact && (
            <>
              <p>
                Bought for{" "}
                <Link
                  href={`/contacts/${o.boughtForContact.id}`}
                  className="font-semibold underline-offset-2 hover:underline"
                >
                  {o.boughtForContact.name}
                </Link>{" "}
                — this is their ornament, not part of your holdings.
              </p>
              {o.memberCharge && (
                <p className="mt-1 text-amber-900 dark:text-amber-200">
                  {formatINR(
                    o.memberCharge.amount - o.memberCharge.settledAmount,
                  )}{" "}
                  still owed to you
                  {o.memberCharge.settledAmount > 0 &&
                    ` · ${formatINR(o.memberCharge.settledAmount)} settled`}
                  .
                </p>
              )}
            </>
          )}
          {o.assignedContact && (
            <p>
              Assigned to{" "}
              <Link
                href={`/contacts/${o.assignedContact.id}`}
                className="font-semibold underline-offset-2 hover:underline"
              >
                {o.assignedContact.name}
              </Link>{" "}
              — still your asset.
            </p>
          )}
          {acq.giftedByContact && (
            <p>
              Gifted by{" "}
              <Link
                href={`/contacts/${acq.giftedByContact.id}`}
                className="font-semibold underline-offset-2 hover:underline"
              >
                {acq.giftedByContact.name}
              </Link>{" "}
              — yours, with ₹0 invested.
              {o.declaredValue != null &&
                ` Valued at ${formatINR(o.declaredValue)} on the gift date.`}
            </p>
          )}
        </div>
      )}

      {o.status !== "HELD" && (
        <div className="rounded-xl border bg-card p-4 text-sm">
          <p>
            {o.status === "SOLD"
              ? "Sold"
              : o.status === "EXCHANGED"
                ? "Traded in against a later bill"
                : "Gifted away"}
            {o.disposedAt ? ` on ${formatDate(o.disposedAt)}` : ""}
            {o.disposalContact ? ` to ${o.disposalContact.name}` : ""}
            {o.disposalAmount != null
              ? ` for ${formatINR(o.disposalAmount)}`
              : ""}
            .
          </p>
          {o.realisedGain != null && (
            <p
              className={cn(
                "mt-1 font-semibold",
                o.realisedGain >= 0
                  ? "text-emerald-700 dark:text-emerald-400"
                  : "text-red-700 dark:text-red-400",
              )}
            >
              Realised {o.realisedGain >= 0 ? "gain" : "loss"}{" "}
              {formatINR(Math.abs(o.realisedGain))} against a cost basis of{" "}
              {formatINR(o.costBasis)}.
            </p>
          )}
        </div>
      )}

      <div>
        <h2 className="mb-2 text-sm font-semibold">This ornament</h2>
        <GoldBreakdown
          weight={o.netWeightGrams}
          ratePerGram={o.ratePerGram}
          goldValue={goldValue}
          wastage={o.wastageAmount}
          making={o.makingAmount}
          cgst={o.cgstAmount}
          sgst={o.sgstAmount}
          roundOff={o.roundOff}
          stones={o.stones ?? []}
        />
      </div>

      {/* The bill, reachable from any piece on it. */}
      <div className="rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Receipt className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">
              {acq.kind === "PURCHASE"
                ? acq.sellerName || "Bill"
                : acq.kind === "GIFT_RECEIVED"
                  ? "Gift"
                  : "Already owned"}
            </h2>
            {acq.billNumber && (
              <span className="text-xs text-muted-foreground">
                {acq.billNumber}
              </span>
            )}
          </div>
          <Link
            href={`/investments/gold/bills/${acq.id}`}
            className="text-xs font-medium text-primary underline-offset-2 hover:underline"
          >
            Open bill
          </Link>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {formatDate(acq.acquiredAt)}
          {acq.billTotal != null ? ` · ${formatINR(acq.billTotal)} total` : ""}
        </p>

        {siblings.length > 0 && (
          <div className="mt-3 border-t pt-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              Also on this bill
            </p>
            <div className="space-y-1">
              {siblings.map((s) => (
                <Link
                  key={s.id}
                  href={`/investments/gold/${s.id}`}
                  className="flex items-center justify-between rounded-md px-2 py-1 text-sm hover:bg-accent/50"
                >
                  <span className="min-w-0 truncate">
                    {s.name}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {s.netWeightGrams}g {s.purity ?? ""}
                      {s.isTheirs ? " · theirs" : ""}
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {formatINR(s.lineTotal)}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}

        <div className="mt-3 border-t pt-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            Bill &amp; attachments (shared by every ornament here)
          </p>
          <AttachmentList ownerKind="GOLD_BILL" ownerId={acq.id} />
        </div>
      </div>

      <div className="rounded-xl border bg-card p-4">
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          Certificates &amp; photos for this piece
        </p>
        <AttachmentList ownerKind="GOLD_ORNAMENT" ownerId={o.id} />
      </div>

      {o.notes && (
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Notes</p>
          <p className="mt-1 text-sm">{o.notes}</p>
        </div>
      )}

      <GoldDisposeDialog
        open={disposing}
        onOpenChange={setDisposing}
        ornament={{ id: o.id, name: o.name, costBasis: o.costBasis }}
        onDone={() => {
          mutate();
          router.refresh();
        }}
      />
    </div>
  );
}
