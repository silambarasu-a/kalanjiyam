"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { ArrowLeft, Gem, Receipt, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmPopover } from "@/components/ui/confirm-popover";
import { Button } from "@/components/ui/button";
import { AttachmentList } from "@/components/attachments/attachment-list";
import { fetcher } from "@/lib/swr-fetcher";
import { formatINR, formatDate, cn } from "@/lib/utils";

type Bill = {
  acquisition: {
    id: string;
    kind: "PURCHASE" | "GIFT_RECEIVED" | "OPENING_STOCK";
    sellerName: string | null;
    billNumber: string | null;
    billTotal: number | null;
    acquiredAt: string;
    notes: string | null;
    investmentId: string | null;
    giftedByContact: { id: string; name: string } | null;
    investment: {
      id: string;
      name: string;
      amount: number;
      quantity: number | null;
      currentValue: number | null;
      active: boolean;
    } | null;
  };
  ornaments: {
    id: string;
    name: string;
    purity: string | null;
    netWeightGrams: number;
    lineTotal: number;
    costBasis: number;
    status: string;
    assignedContact: { id: string; name: string } | null;
    boughtForContact: { id: string; name: string } | null;
    memberCharge: {
      id: string;
      amount: number;
      settledAmount: number;
      status: string;
    } | null;
  }[];
  transactions: {
    id: string;
    type: string;
    amount: number;
    description: string;
    date: string;
    action: string | null;
  }[];
};

const KIND_LABEL: Record<Bill["acquisition"]["kind"], string> = {
  PURCHASE: "Jeweller bill",
  GIFT_RECEIVED: "Gift received",
  OPENING_STOCK: "Already owned",
};

export function GoldBillDetail({ billId }: { billId: string }) {
  const router = useRouter();
  const { data, isLoading } = useSWR<Bill>(
    `/api/gold/acquisitions/${billId}`,
    fetcher,
  );

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (!data) {
    return <p className="text-sm text-muted-foreground">Not found.</p>;
  }

  const { acquisition: acq, ornaments, transactions } = data;
  const ownTotal = ornaments
    .filter((o) => !o.boughtForContact)
    .reduce((a, o) => a + o.lineTotal, 0);
  const theirTotal = ornaments
    .filter((o) => o.boughtForContact)
    .reduce((a, o) => a + o.lineTotal, 0);

  async function remove() {
    const res = await fetch(`/api/gold/acquisitions/${billId}`, {
      method: "DELETE",
    });
    const json = await res.json();
    if (!res.ok) {
      toast.error(json.error ?? "Couldn't delete this bill");
      return;
    }
    toast.success("Bill deleted");
    router.push("/investments/gold");
    router.refresh();
  }

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
            <Receipt className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-2xl font-semibold tracking-tight">
              {acq.sellerName || acq.investment?.name || KIND_LABEL[acq.kind]}
            </h1>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold">
              {KIND_LABEL[acq.kind]}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatDate(acq.acquiredAt)}
            {acq.billNumber ? ` · ${acq.billNumber}` : ""}
            {` · ${ornaments.length} ornament${ornaments.length === 1 ? "" : "s"}`}
            {acq.giftedByContact ? ` · from ${acq.giftedByContact.name}` : ""}
          </p>
        </div>
        <ConfirmPopover
          title="Delete this bill?"
          description="Its ornaments, payments and any receivables it created will be removed."
          confirmLabel="Delete"
          onConfirm={remove}
          trigger={
            <Button variant="outline" className="gap-2 text-destructive">
              <Trash2 className="h-4 w-4" /> Delete bill
            </Button>
          }
        />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Bill total" value={formatINR(ownTotal + theirTotal)} />
        <Stat label="You kept" value={formatINR(ownTotal)} />
        <Stat
          label="Bought for others"
          value={formatINR(theirTotal)}
          sub={theirTotal > 0 ? "not in your holdings" : undefined}
        />
        <Stat
          label="Holding value"
          value={
            acq.investment?.currentValue != null
              ? formatINR(acq.investment.currentValue)
              : "—"
          }
          sub={
            acq.investment
              ? `${acq.investment.quantity ?? 0}g held`
              : "no holding"
          }
        />
      </div>

      {!acq.investmentId && (
        <p className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
          Every ornament on this bill was bought for someone else, so it
          created no holding of your own — only receivables.
        </p>
      )}

      <div>
        <h2 className="mb-2 text-sm font-semibold">Ornaments</h2>
        <div className="divide-y rounded-xl border bg-card">
          {ornaments.map((o) => (
            <Link
              key={o.id}
              href={`/investments/gold/${o.id}`}
              className="flex items-center gap-3 px-4 py-3 transition hover:bg-accent/40"
            >
              <Gem className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium">{o.name}</span>
                  {o.purity && (
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold">
                      {o.purity}
                    </span>
                  )}
                  {o.boughtForContact && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                      {o.boughtForContact.name}&apos;s
                    </span>
                  )}
                  {o.status !== "HELD" && (
                    <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                      {o.status === "SOLD" ? "Sold" : "Gifted away"}
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {o.netWeightGrams}g
                  {o.assignedContact ? ` · for ${o.assignedContact.name}` : ""}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="font-semibold tabular-nums">
                  {formatINR(o.lineTotal)}
                </div>
                {o.memberCharge && (
                  <div className="text-[11px] text-amber-700 dark:text-amber-400">
                    {formatINR(
                      o.memberCharge.amount - o.memberCharge.settledAmount,
                    )}{" "}
                    owed
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      </div>

      {transactions.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold">Payments</h2>
          <div className="divide-y rounded-xl border bg-card">
            {transactions.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between px-4 py-2.5 text-sm"
              >
                <div className="min-w-0">
                  <div className="truncate">{t.description}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatDate(t.date)} · {t.action ?? t.type}
                  </div>
                </div>
                <span
                  className={cn(
                    "shrink-0 tabular-nums font-medium",
                    t.action === "SELL" &&
                      "text-emerald-700 dark:text-emerald-400",
                  )}
                >
                  {formatINR(t.amount)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-xl border bg-card p-4">
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          Bill &amp; attachments
        </p>
        <AttachmentList ownerKind="GOLD_BILL" ownerId={acq.id} />
      </div>

      {acq.notes && (
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Notes</p>
          <p className="mt-1 text-sm">{acq.notes}</p>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
