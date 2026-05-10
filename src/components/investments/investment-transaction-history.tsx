"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmPopover } from "@/components/ui/confirm-popover";
import {
  EditTransactionDialog,
  type EditableTransaction,
} from "@/components/transactions/edit-transaction-dialog";
import { mutateBalances } from "@/lib/mutate-balances";
import { formatINR, formatDate } from "@/lib/utils";

export type InvestmentTxnRow = {
  id: string;
  type: "INCOME" | "EXPENSE" | "INVESTMENT" | "TRANSFER" | "LOAN" | "HAND_LOAN";
  investmentAction: "BUY" | "SELL" | null;
  amount: number;
  date: string;
  description: string;
  /** Card spends carry both — show the card label first; account is the
   * companion. Pure-account spends only have `account`. */
  account: { id: string; name: string; kind: string } | null;
  card: { id: string; name: string; last4: string | null } | null;
};

function sourceLabel(t: InvestmentTxnRow): string {
  if (t.card) {
    return t.card.last4 ? `${t.card.name} ••${t.card.last4}` : t.card.name;
  }
  if (t.account) return t.account.name;
  return "—";
}

export function InvestmentTransactionHistory({
  transactions,
}: {
  transactions: InvestmentTxnRow[];
}) {
  const router = useRouter();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditableTransaction | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  async function handleDelete(t: InvestmentTxnRow) {
    setDeletingId(t.id);
    try {
      const res = await fetch(`/api/transactions/${t.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}) as { error?: string });
      if (!res.ok) {
        toast.error(body.error ?? "Failed to delete");
        return;
      }
      toast.success("Transaction deleted");
      await mutateBalances();
      router.refresh();
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      <section className="rounded-lg border bg-card">
        <header className="px-5 py-3 border-b">
          <h2 className="text-sm font-semibold">Transaction history</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {transactions.length}{" "}
            {transactions.length === 1 ? "entry" : "entries"}
          </p>
        </header>
        {transactions.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">
            No transactions yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b bg-muted/30">
                  <th className="px-5 py-2">Date</th>
                  <th className="px-5 py-2">Description</th>
                  <th className="px-5 py-2">Source</th>
                  <th className="px-5 py-2 text-right">Amount</th>
                  <th className="w-20 px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {transactions.map((t) => {
                  const isOut =
                    t.type === "EXPENSE" || t.investmentAction === "BUY";
                  const busy = deletingId === t.id;
                  return (
                    <tr
                      key={t.id}
                      className="border-b last:border-0 hover:bg-muted/20"
                    >
                      <td className="px-5 py-2.5 text-muted-foreground whitespace-nowrap tabular-nums">
                        {formatDate(t.date)}
                      </td>
                      <td className="px-5 py-2.5">
                        <div className="font-medium truncate">{t.description}</div>
                      </td>
                      <td className="px-5 py-2.5 text-muted-foreground whitespace-nowrap">
                        {sourceLabel(t)}
                      </td>
                      <td
                        className={`px-5 py-2.5 text-right font-semibold tabular-nums ${
                          isOut
                            ? "text-destructive"
                            : "text-emerald-700 dark:text-emerald-400"
                        }`}
                      >
                        {isOut ? "−" : "+"}
                        {formatINR(t.amount)}
                      </td>
                      <td className="px-2 py-2.5 text-right whitespace-nowrap">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Edit transaction"
                          onClick={() => {
                            setEditing({
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
                          description={
                            <>
                              Removing the{" "}
                              <span className="font-medium text-foreground tabular-nums">
                                {formatINR(t.amount)}
                              </span>{" "}
                              entry from {formatDate(t.date)} will reverse the
                              holding&rsquo;s amount and quantity.
                            </>
                          }
                          confirmLabel="Delete"
                          busyLabel="Deleting…"
                          busy={busy}
                          onConfirm={() => handleDelete(t)}
                          trigger={
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Delete transaction"
                              disabled={busy}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          }
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <EditTransactionDialog
        transaction={editing}
        open={editOpen}
        onOpenChange={(o) => {
          setEditOpen(o);
          if (!o) setEditing(null);
        }}
        onSaved={async () => {
          await mutateBalances();
          router.refresh();
        }}
      />
    </>
  );
}
