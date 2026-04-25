"use client";

import { useState } from "react";
import useSWR from "swr";
import { Plus, Trash2, ArrowLeftRight, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  const { data, isLoading } = useSWR<{ transactions: Txn[] }>(url, fetcher);
  const { openDialog } = useTransactionDialog();

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

      <div className="rounded-lg border bg-card divide-y">
        {(data?.transactions ?? []).map((t) => {
          const Icon =
            t.transferId
              ? ArrowLeftRight
              : t.type === "INCOME"
                ? ArrowDownLeft
                : ArrowUpRight;
          const sign = t.transferId ? "" : t.type === "INCOME" ? "+" : "−";
          const color = t.transferId
            ? "text-muted-foreground"
            : t.type === "INCOME"
              ? "text-emerald-700"
              : "text-red-700";
          return (
            <div key={t.id} className="flex items-center gap-3 px-5 py-3">
              <Icon className={`h-4 w-4 shrink-0 ${color}`} />
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{t.description}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {formatDate(t.date)}
                  {t.account ? ` · ${t.account.name}` : ""}
                  {t.card ? ` · ${t.card.name}` : ""}
                  {t.category ? ` · ${t.category.name}` : ""}
                  {t.beneficiary ? ` · for ${t.beneficiary.name}` : ""}
                  {t.memberChargeType === "RECOVERABLE" ? " (recover)" : ""}
                  {t.memberChargeType === "GIFT" ? " (gift)" : ""}
                </div>
              </div>
              <div className={`font-semibold ${color}`}>
                {sign}
                {formatINR(t.amount)}
              </div>
              {!t.transferId && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={async () => {
                    if (!confirm("Delete this transaction?")) return;
                    const res = await fetch(`/api/transactions/${t.id}`, { method: "DELETE" });
                    if (!res.ok) {
                      const body = await res.json();
                      alert(body.error ?? "Failed");
                    }
                    mutateBalances();
                  }}
                  aria-label="Delete"
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              )}
            </div>
          );
        })}
        {(data?.transactions ?? []).length === 0 && !isLoading && (
          <div className="px-5 py-8 text-sm text-muted-foreground text-center">
            No transactions yet. Tap the orange button to record your first one.
          </div>
        )}
      </div>
    </div>
  );
}
