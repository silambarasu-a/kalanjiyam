"use client";

import useSWR from "swr";
import { ArrowRight, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTransactionDialog } from "@/contexts/transaction-dialog";
import { mutateBalances } from "@/lib/mutate-balances";
import { formatINR, formatDate } from "@/lib/utils";

type Transfer = {
  id: string;
  amount: number;
  date: string;
  notes: string | null;
  from: { id: string; name: string; kind: string };
  to: { id: string; name: string; kind: string };
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function TransfersPage() {
  const { data, isLoading } = useSWR<{ transfers: Transfer[] }>("/api/transfers", fetcher);
  const { openDialog } = useTransactionDialog();

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Transfers</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Money moved between your accounts. Each transfer creates two transaction legs.
          </p>
        </div>
        <Button onClick={() => openDialog("TRANSFER")} className="gap-2">
          <Plus className="h-4 w-4" /> New transfer
        </Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      <div className="rounded-lg border bg-card divide-y">
        {(data?.transfers ?? []).map((t) => (
          <div key={t.id} className="flex items-center gap-3 px-5 py-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 font-medium">
                <span className="truncate">{t.from.name}</span>
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
                <span className="truncate">{t.to.name}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                {formatDate(t.date)}
                {t.notes ? ` · ${t.notes}` : ""}
              </div>
            </div>
            <div className="font-semibold">{formatINR(t.amount)}</div>
            <Button
              variant="ghost"
              size="icon"
              onClick={async () => {
                if (!confirm("Delete this transfer?")) return;
                const res = await fetch(`/api/transfers/${t.id}`, { method: "DELETE" });
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
          </div>
        ))}
        {(data?.transfers ?? []).length === 0 && !isLoading && (
          <div className="px-5 py-8 text-sm text-muted-foreground text-center">
            No transfers yet.
          </div>
        )}
      </div>
    </div>
  );
}
