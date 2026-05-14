"use client";
import { toast } from "sonner";

import { useMemo, useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { Plus, Pencil, Trash2, ArrowLeftRight, ArrowDownLeft, ArrowUpRight, RotateCcw, Eye, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmPopover } from "@/components/ui/confirm-popover";
import {
  EditTransactionDialog,
  type EditableTransaction,
} from "@/components/transactions/edit-transaction-dialog";
import { TransactionDetailDialog } from "@/components/transactions/transaction-detail-dialog";
import {
  ListFilterBar,
  PaginationFooter,
  periodToRange,
  type PeriodValue,
} from "@/components/transactions/list-filter-bar";
import { useTransactionDialog } from "@/contexts/transaction-dialog";
import { mutateBalances } from "@/lib/mutate-balances";
import { formatINR, formatDate } from "@/lib/utils";

type Txn = {
  id: string;
  type: "INCOME" | "EXPENSE" | "INVESTMENT" | "HAND_LOAN" | "TRANSFER";
  kind: string | null;
  amount: number;
  description: string;
  date: string;
  category: {
    id: string;
    name: string;
    group: string | null;
    parent: { id: string; name: string } | null;
  } | null;
  account: { id: string; name: string; kind: string } | null;
  card: { id: string; name: string } | null;
  beneficiary: { id: string; name: string } | null;
  memberChargeType: "NONE" | "RECOVERABLE" | "GIFT";
  memberCharge: { id: string; status: string } | null;
  transferId: string | null;
  transferDirection: "OUT" | "IN" | null;
  transferCounterparty: { name: string; kind: "ACCOUNT" | "CONTACT" } | null;
  refundForTransactionId: string | null;
  eventId: string | null;
  vehicleId: string | null;
  fuelQuantity: number | null;
  fuelUnit: string | null;
  fuelOdometer: number | null;
  attachmentCount: number;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

/**
 * Fetch the transaction's detail (which includes presigned attachment
 * URLs) and trigger a direct download of the most recent attachment.
 * Single-click path for "Download" on rows with exactly one
 * attachment — multi-attachment rows route to the detail dialog
 * instead so the user can pick.
 */
async function downloadFirstAttachment(txnId: string) {
  try {
    const res = await fetch(`/api/transactions/${txnId}`);
    if (!res.ok) {
      toast.error("Could not fetch attachment");
      return;
    }
    const body: {
      attachments?: { url: string | null; filename: string }[];
    } = await res.json();
    const first = body.attachments?.[0];
    if (!first?.url) {
      toast.error("Attachment URL unavailable");
      return;
    }
    const a = document.createElement("a");
    a.href = first.url;
    a.download = first.filename;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } catch {
    toast.error("Network error");
  }
}

const PAGE_SIZE = 50;

export default function TransactionsPage() {
  const [filter, setFilter] = useState<"ALL" | "INCOME" | "EXPENSE" | "TRANSFER">("ALL");
  const [period, setPeriod] = useState<PeriodValue>({ kind: "all" });
  const [offset, setOffset] = useState(0);
  const url = useMemo(() => {
    const params = new URLSearchParams();
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(offset));
    if (filter !== "ALL") params.set("type", filter);
    const { from, to } = periodToRange(period);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    return `/api/transactions?${params.toString()}`;
  }, [filter, period, offset]);
  const { data, isLoading, mutate: mutateList } = useSWR<{
    transactions: Txn[];
    pagination: { total: number; offset: number; limit: number };
  }>(url, fetcher);
  const { openDialog } = useTransactionDialog();
  const [editingTxn, setEditingTxn] = useState<EditableTransaction | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  // Detail (read-only) view — separate state from edit so we can hand
  // off "Edit" from inside the detail dialog without races.
  const [viewingTxnId, setViewingTxnId] = useState<string | null>(null);
  const [viewOpen, setViewOpen] = useState(false);

  // Reset to page 1 when filters change.
  function setFilterReset(next: typeof filter) {
    setFilter(next);
    setOffset(0);
  }
  function setPeriodReset(next: PeriodValue) {
    setPeriod(next);
    setOffset(0);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Transactions</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Income, expense, and transfers in one log. Use the orange button to add more.
          </p>
        </div>
        <Button onClick={() => openDialog("EXPENSE")} className="gap-2">
          <Plus className="h-4 w-4" /> New
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {(["ALL", "INCOME", "EXPENSE", "TRANSFER"] as const).map((k) => (
            <Button
              key={k}
              size="sm"
              variant={filter === k ? "default" : "outline"}
              onClick={() => setFilterReset(k)}
            >
              {k.charAt(0) + k.slice(1).toLowerCase()}
            </Button>
          ))}
        </div>
        <div className="sm:ml-auto">
          <ListFilterBar value={period} onChange={setPeriodReset} />
        </div>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      <div className="rounded-lg border bg-card">
        {(data?.transactions ?? []).length === 0 && !isLoading ? (
          <div className="px-5 py-8 text-sm text-muted-foreground text-center">
            No transactions yet. Tap the orange button to record your first one.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b bg-muted/30">
                  <th className="w-8 px-3 py-2" />
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Description</th>
                  <th className="px-3 py-2">Account</th>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="w-20 px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {(data?.transactions ?? []).map((t) => {
                  // Negative-amount EXPENSE = contra-expense (e.g. wage
                  // advance return). Treat as inflow: green, "+", abs value.
                  // For TRANSFER legs, direction is leg-specific: OUT side
                  // is outflow (red, "−"), IN side is inflow (green, "+").
                  const isTransferOut =
                    t.transferId != null && t.transferDirection === "OUT";
                  const isTransferIn =
                    t.transferId != null && t.transferDirection === "IN";
                  const isInflow =
                    t.type === "INCOME" ||
                    (t.type === "EXPENSE" && t.amount < 0) ||
                    isTransferIn;
                  const isOutflow =
                    !isInflow &&
                    (t.type === "EXPENSE" || isTransferOut);
                  const isRefund = t.kind === "REFUND";
                  const Icon = isRefund
                    ? RotateCcw
                    : isTransferIn
                    ? ArrowDownLeft
                    : isTransferOut
                      ? ArrowUpRight
                      : t.transferId
                        ? ArrowLeftRight
                        : isInflow
                          ? ArrowDownLeft
                          : ArrowUpRight;
                  const sign = isInflow ? "+" : isOutflow ? "−" : "";
                  const color = isInflow
                    ? "text-emerald-700 dark:text-emerald-400"
                    : isOutflow
                      ? "text-destructive"
                      : "text-muted-foreground";
                  const displayAmount = Math.abs(t.amount);
                  const accountLabel = t.account?.name ?? t.card?.name ?? "—";
                  return (
                    <tr
                      key={t.id}
                      className="border-b last:border-0 hover:bg-muted/20"
                    >
                      <td className="px-3 py-2.5">
                        <Icon className={`h-4 w-4 ${color}`} />
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap tabular-nums">
                        {formatDate(t.date)}
                      </td>
                      <td className="px-3 py-2.5 max-w-[20rem]">
                        <div className="font-medium truncate flex items-center gap-1.5">
                          {isRefund && (
                            <span className="inline-flex items-center rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider shrink-0">
                              Refund
                            </span>
                          )}
                          <span className="truncate">{t.description}</span>
                        </div>
                        {t.transferCounterparty ? (
                          <div className="text-[11px] text-muted-foreground truncate">
                            {isTransferOut ? "→ to " : "← from "}
                            {t.transferCounterparty.name}
                          </div>
                        ) : (
                          (t.beneficiary ||
                            t.memberChargeType === "RECOVERABLE") && (
                            <div className="text-[11px] text-muted-foreground truncate">
                              {t.beneficiary ? `for ${t.beneficiary.name}` : ""}
                              {t.memberChargeType === "RECOVERABLE"
                                ? " (recover)"
                                : ""}
                            </div>
                          )
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                        {accountLabel}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                        {t.transferId ? (
                          <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                            {isTransferOut ? "Transfer out" : isTransferIn ? "Transfer in" : "Transfer"}
                          </span>
                        ) : t.category ? (
                          t.category.parent ? (
                            <span>
                              <span className="text-muted-foreground/70">
                                {t.category.parent.name} ›{" "}
                              </span>
                              {t.category.name}
                            </span>
                          ) : (
                            t.category.name
                          )
                        ) : (
                          "—"
                        )}
                      </td>
                      <td
                        className={`px-3 py-2.5 text-right font-semibold tabular-nums whitespace-nowrap ${color}`}
                      >
                        {sign}
                        {formatINR(displayAmount)}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {!t.transferId && (
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="View details"
                              title="View details"
                              onClick={() => {
                                setViewingTxnId(t.id);
                                setViewOpen(true);
                              }}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            {t.attachmentCount > 0 && (
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Download attachment${t.attachmentCount > 1 ? "s" : ""}`}
                                title={
                                  t.attachmentCount === 1
                                    ? "Download attachment"
                                    : `${t.attachmentCount} attachments — open details to pick`
                                }
                                onClick={async () => {
                                  if (t.attachmentCount > 1) {
                                    // Multiple files — open the detail
                                    // dialog so the user can pick which
                                    // one to download.
                                    setViewingTxnId(t.id);
                                    setViewOpen(true);
                                    return;
                                  }
                                  // Single attachment — fetch detail
                                  // (gives us the presigned URL) and
                                  // trigger an immediate download.
                                  await downloadFirstAttachment(t.id);
                                }}
                              >
                                <Download className="h-4 w-4" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Edit"
                              title="Edit"
                              onClick={() => {
                                setEditingTxn({
                                  id: t.id,
                                  type: t.type,
                                  amount: t.amount,
                                  date: t.date,
                                  description: t.description,
                                  categoryId: t.category?.id ?? null,
                                  vehicleId: t.vehicleId,
                                  eventId: t.eventId ?? null,
                                  fuelQuantity: t.fuelQuantity,
                                  fuelUnit: t.fuelUnit,
                                  fuelOdometer: t.fuelOdometer,
                                });
                                setEditOpen(true);
                              }}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <ConfirmPopover
                              title="Delete this transaction?"
                              description="Linked records — loan outstanding, investment holdings, wage logs — will be reversed."
                              confirmLabel="Delete"
                              busyLabel="Deleting…"
                              onConfirm={async () => {
                                const res = await fetch(
                                  `/api/transactions/${t.id}`,
                                  { method: "DELETE" },
                                );
                                if (!res.ok) {
                                  const body = await res
                                    .json()
                                    .catch(() => ({}));
                                  toast.error(body.error ?? "Failed");
                                  throw new Error(body.error ?? "Failed");
                                }
                                toast.success("Transaction deleted");
                                mutateList();
                                await mutateBalances();
                              }}
                              trigger={
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label="Delete"
                                >
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              }
                            />
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {data?.pagination && (
        <PaginationFooter
          total={data.pagination.total}
          offset={data.pagination.offset}
          limit={data.pagination.limit}
          onChange={setOffset}
        />
      )}

      <EditTransactionDialog
        transaction={editingTxn}
        open={editOpen}
        onOpenChange={(o) => {
          setEditOpen(o);
          if (!o) setEditingTxn(null);
        }}
        onSaved={async () => {
          mutateList();
          await mutateBalances();
          // Refresh any open loan / investment lists too.
          globalMutate(
            (k) =>
              typeof k === "string" &&
              (k.startsWith("/api/loans") || k.startsWith("/api/investments")),
          );
        }}
      />

      <TransactionDetailDialog
        transactionId={viewingTxnId}
        open={viewOpen}
        onOpenChange={(o) => {
          setViewOpen(o);
          if (!o) setViewingTxnId(null);
        }}
        onEdit={() => {
          // Find the full row from the cached list and hand off to the
          // edit dialog. No extra round trip — the list already has
          // every field the edit dialog needs.
          const row = data?.transactions.find((x) => x.id === viewingTxnId);
          if (!row) return;
          setEditingTxn({
            id: row.id,
            type: row.type,
            amount: row.amount,
            date: row.date,
            description: row.description,
            categoryId: row.category?.id ?? null,
            vehicleId: row.vehicleId,
            eventId: row.eventId ?? null,
            fuelQuantity: row.fuelQuantity,
            fuelUnit: row.fuelUnit,
            fuelOdometer: row.fuelOdometer,
          });
          setViewOpen(false);
          setEditOpen(true);
        }}
      />
    </div>
  );
}
