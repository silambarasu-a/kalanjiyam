"use client";
import { toast } from "sonner";

import { useState } from "react";
import Link from "next/link";
import useSWR, { mutate as globalMutate } from "swr";
import { Plus, Pencil, Trash2, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CardForm, type CardSnapshot } from "@/components/cards/card-form";
import { formatINR } from "@/lib/utils";

type Card = CardSnapshot & {
  active: boolean;
  ownerUser: { id: string; name: string } | null;
  ownerMember: { id: string; name: string } | null;
  accountId: string | null;
  availableLimit: number | null;
  sharedWithUserIds: string[];
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function CardsPage() {
  const { data, isLoading } = useSWR<{ cards: Card[] }>("/api/cards", fetcher);
  const [editOpen, setEditOpen] = useState<Card | "new" | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Cards</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Debit and credit cards. Credit cards track statement spend and show your available
            limit (creditLimit − active EMI principal − current statement spend).
          </p>
        </div>
        <Button onClick={() => setEditOpen("new")} className="gap-2">
          <Plus className="h-4 w-4" /> New card
        </Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {(data?.cards ?? []).map((c) => (
          <div key={c.id} className="rounded-lg border bg-card p-5 flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
              <Link href={`/cards/${c.id}`} className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-muted-foreground" />
                  <h3 className="truncate font-semibold">{c.name}</h3>
                </div>
                <div className="mt-0.5 text-xs uppercase tracking-wider text-muted-foreground">
                  {c.kind} · {c.network}
                  {c.supportsUpi ? " · UPI" : ""}
                  {c.last4 ? ` · ••${c.last4}` : ""}
                </div>
              </Link>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setEditOpen(c)}
                  aria-label="Edit"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={async () => {
                    if (!confirm(`Delete ${c.name}?`)) return;
                    const res = await fetch(`/api/cards/${c.id}`, { method: "DELETE" });
                    if (!res.ok) {
                      const body = await res.json();
                      toast.error(body.error ?? "Failed");
                    }
                    globalMutate("/api/cards");
                  }}
                  aria-label="Delete"
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
            {c.kind === "CREDIT" && c.creditLimit != null && (
              <div>
                <div className="text-xs text-muted-foreground">Available limit</div>
                <div className="text-2xl font-semibold">
                  {formatINR(c.availableLimit ?? c.creditLimit)}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  of {formatINR(c.creditLimit)} total
                </div>
              </div>
            )}
            {c.kind === "DEBIT" && c.parentAccount && (
              <div className="text-xs text-muted-foreground">
                Linked to {c.parentAccount.name}
              </div>
            )}
          </div>
        ))}
        {(data?.cards ?? []).length === 0 && !isLoading && (
          <div className="col-span-full rounded-lg border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
            No cards yet. Add your debit or credit cards for UPI payments and EMI tracking.
          </div>
        )}
      </div>

      <Dialog open={editOpen !== null} onOpenChange={(o) => !o && setEditOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editOpen && editOpen !== "new" ? "Edit card" : "New card"}</DialogTitle>
          </DialogHeader>
          <CardForm
            card={editOpen === "new" || editOpen === null ? null : (editOpen as Card)}
            onSaved={() => setEditOpen(null)}
            onCancel={() => setEditOpen(null)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
