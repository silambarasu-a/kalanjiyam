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

export type LoanPaymentRow = {
  id: string;
  type: "INCOME" | "EXPENSE" | "INVESTMENT" | "HAND_LOAN" | "TRANSFER";
  kind: string | null;
  amount: number;
  date: string;
  description: string;
};

export function LoanPaymentHistory({
  payments,
  totalRepaid,
}: {
  payments: LoanPaymentRow[];
  totalRepaid: number;
}) {
  const router = useRouter();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditableTransaction | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  async function handleDelete(p: LoanPaymentRow) {
    setDeletingId(p.id);
    try {
      const res = await fetch(`/api/transactions/${p.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}) as { error?: string });
      if (!res.ok) {
        toast.error(body.error ?? "Failed to delete");
        throw new Error(body.error ?? "Failed");
      }
      toast.success("Payment deleted");
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
        <h2 className="text-sm font-semibold">Payment history</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {payments.length} {payments.length === 1 ? "entry" : "entries"} ·{" "}
          {formatINR(totalRepaid)} repaid
        </p>
      </header>
      {payments.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted-foreground">
          No payments recorded yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b bg-muted/30">
              <th className="px-5 py-2">Date</th>
              <th className="px-5 py-2">Description</th>
              <th className="px-5 py-2 text-right">Amount</th>
              <th className="w-20 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => {
              const isIncome = p.type === "INCOME";
              const isDisbursement = isIncome && p.kind === "LOAN_PAYMENT";
              const busy = deletingId === p.id;
              return (
                <tr key={p.id} className="border-b last:border-0 hover:bg-muted/20">
                  <td className="px-5 py-2.5 text-muted-foreground whitespace-nowrap tabular-nums">
                    {formatDate(p.date)}
                  </td>
                  <td className="px-5 py-2.5">
                    <div className="font-medium truncate">{p.description}</div>
                  </td>
                  <td
                    className={`px-5 py-2.5 text-right font-semibold tabular-nums ${
                      isIncome
                        ? "text-emerald-700 dark:text-emerald-400"
                        : "text-destructive"
                    }`}
                  >
                    {isIncome ? "+" : "−"}
                    {formatINR(p.amount)}
                  </td>
                  <td className="px-2 py-2.5 text-right whitespace-nowrap">
                    {!isDisbursement && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Edit payment"
                        onClick={() => {
                          setEditing({
                            id: p.id,
                            amount: p.amount,
                            date: p.date,
                            description: p.description,
                          });
                          setEditOpen(true);
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                    {!isDisbursement && (
                      <ConfirmPopover
                        title="Delete this payment?"
                        description={
                          <>
                            Removing the{" "}
                            <span className="font-medium text-foreground tabular-nums">
                              {formatINR(p.amount)}
                            </span>{" "}
                            entry from {formatDate(p.date)} will restore the
                            loan&rsquo;s outstanding.
                          </>
                        }
                        confirmLabel="Delete"
                        busyLabel="Deleting…"
                        busy={busy}
                        onConfirm={() => handleDelete(p)}
                        trigger={
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Delete payment"
                            disabled={busy}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        }
                      />
                    )}
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
