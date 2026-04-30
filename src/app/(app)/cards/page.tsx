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
import { MoneyValue } from "@/components/ui/money-tone";

type Card = CardSnapshot & {
  active: boolean;
  ownerUser: { id: string; name: string } | null;
  ownerContact: { id: string; name: string } | null;
  accountId: string | null;
  availableLimit: number | null;
  linkedBalance: number | null;
  currentBalance: number | null;
  upcomingBillAmount: number | null;
  limitMode: "SOLO" | "SHARED";
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

      {(() => {
        // Aggregate across active CREDIT cards only. SHARED sub-cards
        // inherit their parent's pool, so summing their inherited
        // creditLimit / availableLimit would double-count the parent's
        // pool. Skip them in the totals.
        const credit = (data?.cards ?? []).filter(
          (c) => c.kind === "CREDIT" && c.active && c.limitMode !== "SHARED",
        );
        if (credit.length === 0) return null;
        const totalLimit = credit.reduce(
          (s, c) => s + (c.creditLimit ?? 0),
          0,
        );
        const totalAvailable = credit.reduce(
          (s, c) => s + (c.availableLimit ?? c.creditLimit ?? 0),
          0,
        );
        const totalOutstanding = Math.max(0, totalLimit - totalAvailable);
        const totalDue = credit.reduce(
          (s, c) => s + (c.upcomingBillAmount ?? 0),
          0,
        );
        return (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <SummaryStat label="Total limit" value={formatINR(totalLimit)} />
            <SummaryStat
              label="Available"
              value={formatINR(totalAvailable)}
              tone="gain"
            />
            <SummaryStat
              label="Total outstanding"
              value={formatINR(totalOutstanding)}
              tone={totalOutstanding > 0 ? "loss" : "muted"}
            />
            <SummaryStat
              label="Total due"
              value={formatINR(totalDue)}
              tone={totalDue > 0 ? "loss" : "muted"}
              hint={totalDue > 0 ? "Across upcoming bills" : "Nothing pending"}
            />
          </div>
        );
      })()}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {(data?.cards ?? []).map((c) => (
          <Link
            key={c.id}
            href={`/cards/${c.id}`}
            className="rounded-lg border bg-card p-5 flex flex-col gap-3 transition-colors hover:bg-muted/30 focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-muted-foreground" />
                  <h3 className="truncate font-semibold">{c.name}</h3>
                </div>
                <div className="mt-0.5 text-xs uppercase tracking-wider text-muted-foreground">
                  {c.kind} · {c.network}
                  {c.supportsUpi ? " · UPI" : ""}
                  {c.last4 ? ` · ••${c.last4}` : ""}
                </div>
              </div>
              {/* Action buttons sit above the link via relative+z-10 so
                  they're clickable without bubbling into navigation. */}
              <div
                className="relative z-10 flex gap-1"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
              >
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setEditOpen(c);
                  }}
                  aria-label="Edit"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
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
                {(() => {
                  const avail = c.availableLimit ?? c.creditLimit;
                  const outstanding = Math.max(0, c.creditLimit - avail);
                  const pct = c.creditLimit > 0 ? avail / c.creditLimit : 1;
                  const tone =
                    pct > 0.5 ? "gain" : pct > 0.2 ? "outstanding" : "loss";
                  return (
                    <>
                      <div className="text-xs text-muted-foreground">
                        Available limit
                      </div>
                      <MoneyValue
                        tone={tone}
                        value={formatINR(avail)}
                        className="text-2xl font-semibold mt-1"
                        icon={false}
                      />
                      <div className="mt-1.5 h-1.5 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className={
                            tone === "gain"
                              ? "h-full bg-primary"
                              : tone === "outstanding"
                                ? "h-full bg-amber-500"
                                : "h-full bg-destructive"
                          }
                          style={{ width: `${Math.max(0, Math.min(100, pct * 100))}%` }}
                        />
                      </div>
                      <div className="mt-1 flex items-center justify-between text-xs">
                        {outstanding > 0 ? (
                          <span className="font-medium text-destructive tabular-nums">
                            Outstanding {formatINR(outstanding)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">No dues</span>
                        )}
                        <span className="text-muted-foreground tabular-nums">
                          of {formatINR(c.creditLimit)}
                        </span>
                      </div>
                    </>
                  );
                })()}
              </div>
            )}
            {c.kind === "DEBIT" && c.parentAccount && (
              <div>
                <div className="text-xs text-muted-foreground">Available balance</div>
                <MoneyValue
                  tone={
                    c.linkedBalance == null
                      ? "neutral"
                      : c.linkedBalance > 0
                        ? "gain"
                        : "loss"
                  }
                  value={c.linkedBalance == null ? "—" : formatINR(c.linkedBalance)}
                  className="text-2xl font-semibold mt-1"
                  icon={false}
                />
                <div className="mt-1 text-xs text-muted-foreground">
                  via {c.parentAccount.name}
                </div>
              </div>
            )}
          </Link>
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

function SummaryStat({
  label,
  value,
  hint,
  tone = "muted",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "muted" | "gain" | "loss";
}) {
  const valueClass =
    tone === "gain"
      ? "text-emerald-700 dark:text-emerald-400"
      : tone === "loss"
        ? "text-destructive"
        : "";
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${valueClass}`}>
        {value}
      </div>
      {hint && (
        <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>
      )}
    </div>
  );
}
