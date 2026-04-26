"use client";
import { toast } from "sonner";

import { useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { Plus, Pencil, Trash2, ArrowLeftRight, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmPopover } from "@/components/ui/confirm-popover";
import {
  EditTransactionDialog,
  type EditableTransaction,
} from "@/components/transactions/edit-transaction-dialog";
import { useTransactionDialog } from "@/contexts/transaction-dialog";
import { mutateBalances } from "@/lib/mutate-balances";
import { formatINR, formatDate } from "@/lib/utils";

type Txn = {
  id: string;
  type: "INCOME" | "EXPENSE" | "INVESTMENT" | "HAND_LOAN" | "TRANSFER";
  amount: number;
  description: string;
  date: string;
  category: { id: string; name: string; group: string | null } | null;
  account: { id: string; name: string; kind: string } | null;
  card: { id: string; name: string } | null;
  beneficiary: { id: string; name: string } | null;
  memberChargeType: "NONE" | "RECOVERABLE" | "GIFT";
  memberCharge: { id: string; status: string } | null;
  transferId: string | null;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function TransactionsPage() {
  const [filter, setFilter] = useState<"ALL" | "INCOME" | "EXPENSE" | "TRANSFER">("ALL");
  const url =
    filter === "ALL" ? "/api/transactions?limit=100" : `/api/transactions?limit=100&type=${filter}`;
  const { data, isLoading, mutate: mutateList } = useSWR<{ transactions: Txn[] }>(url, fetcher);
  const { openDialog } = useTransactionDialog();
  const [editingTxn, setEditingTxn] = useState<EditableTransaction | null>(null);
  const [editOpen, setEditOpen] = useState(false);

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

      <div className="flex gap-2 overflow-x-auto pb-1">
        {(["ALL", "INCOME", "EXPENSE", "TRANSFER"] as const).map((k) => (
          <Button
            key={k}
            size="sm"
            variant={filter === k ? "default" : "outline"}
            onClick={() => setFilter(k)}
          >
            {k.charAt(0) + k.slice(1).toLowerCase()}
          </Button>
        ))}
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
                  const Icon = t.transferId
                    ? ArrowLeftRight
                    : t.type === "INCOME"
                      ? ArrowDownLeft
                      : ArrowUpRight;
                  const sign = t.transferId
                    ? ""
                    : t.type === "INCOME"
                      ? "+"
                      : "−";
                  const color = t.transferId
                    ? "text-muted-foreground"
                    : t.type === "INCOME"
                      ? "text-emerald-700 dark:text-emerald-400"
                      : "text-destructive";
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
                        <div className="font-medium truncate">
                          {t.description}
                        </div>
                        {(t.beneficiary ||
                          t.memberChargeType === "RECOVERABLE") && (
                          <div className="text-[11px] text-muted-foreground truncate">
                            {t.beneficiary ? `for ${t.beneficiary.name}` : ""}
                            {t.memberChargeType === "RECOVERABLE"
                              ? " (recover)"
                              : ""}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                        {accountLabel}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                        {t.category?.name ?? "—"}
                      </td>
                      <td
                        className={`px-3 py-2.5 text-right font-semibold tabular-nums whitespace-nowrap ${color}`}
                      >
                        {sign}
                        {formatINR(t.amount)}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {!t.transferId && (
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Edit"
                              onClick={() => {
                                setEditingTxn({
                                  id: t.id,
                                  amount: t.amount,
                                  date: t.date,
                                  description: t.description,
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
    </div>
  );
}
