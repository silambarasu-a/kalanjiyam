"use client";
import { toast } from "sonner";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { ArrowRight, Plus, Trash2, User, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTransactionDialog } from "@/contexts/transaction-dialog";
import { mutateBalances } from "@/lib/mutate-balances";
import { formatINR, formatDate } from "@/lib/utils";

type Account = { id: string; name: string; kind: string };
type Member = { id: string; name: string };

type Transfer = {
  id: string;
  amount: number;
  date: string;
  notes: string | null;
  fromAccount: Account | null;
  fromContact: Member | null;
  toAccount: Account | null;
  toContact: Member | null;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function PartyLabel({
  account,
  member,
}: {
  account: Account | null;
  member: Member | null;
}) {
  if (account) return <span className="truncate">{account.name}</span>;
  if (member) {
    return (
      <span className="inline-flex items-center gap-1 truncate">
        <User className="h-3 w-3 text-muted-foreground" />
        {member.name}
      </span>
    );
  }
  return null;
}

export default function TransfersPage() {
  const search = useSearchParams();
  const contactId = search?.get("contact") ?? null;
  const url = contactId
    ? `/api/transfers?contact=${encodeURIComponent(contactId)}`
    : "/api/transfers";
  const { data, isLoading } = useSWR<{ transfers: Transfer[] }>(url, fetcher);
  const { openDialog } = useTransactionDialog();

  const contactName = (() => {
    if (!contactId || !data?.transfers) return null;
    for (const t of data.transfers) {
      if (t.fromContact?.id === contactId) return t.fromContact.name;
      if (t.toContact?.id === contactId) return t.toContact.name;
    }
    return null;
  })();

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Transfers</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Money moved between your accounts, or sent to / received from a person.
          </p>
        </div>
        <Button onClick={() => openDialog("TRANSFER")} className="gap-2">
          <Plus className="h-4 w-4" /> New transfer
        </Button>
      </div>

      {contactId && (
        <div className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs">
          <span className="text-muted-foreground">Filtered by contact:</span>
          <span className="font-medium">{contactName ?? "(loading)"}</span>
          <Link
            href="/transfers"
            aria-label="Clear filter"
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </Link>
        </div>
      )}

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      <div className="rounded-lg border bg-card divide-y">
        {(data?.transfers ?? []).map((t) => (
          <div key={t.id} className="flex items-center gap-3 px-5 py-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 font-medium">
                <PartyLabel account={t.fromAccount} member={t.fromContact} />
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
                <PartyLabel account={t.toAccount} member={t.toContact} />
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
                  toast.error(body.error ?? "Failed");
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
