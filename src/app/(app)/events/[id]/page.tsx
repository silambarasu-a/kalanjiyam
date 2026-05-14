"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { toast } from "sonner";
import {
  ArrowLeft,
  Archive,
  ArchiveRestore,
  Pencil,
  Trash2,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { AttachmentList } from "@/components/attachments/attachment-list";
import { EventDialog } from "@/components/events/event-dialog";
import { hasPermission } from "@/lib/permissions";
import { formatINR, formatDate } from "@/lib/utils";

type EventDetail = {
  event: {
    id: string;
    name: string;
    kind: "TRIP" | "FUNCTION" | "FESTIVAL" | "PROJECT" | "MEDICAL" | "OTHER";
    startedAt: string;
    endedAt: string | null;
    notes: string | null;
    budget: number | null;
    active: boolean;
  };
  totalSpent: number;
  breakdown: {
    categoryId: string | null;
    label: string;
    total: number;
  }[];
  memberSplits: {
    contactId: string;
    contactName: string;
    owes: number;
    settled: number;
  }[];
  transactions: {
    id: string;
    date: string;
    type: string;
    amount: number;
    description: string;
    categoryId: string | null;
    categoryLabel: string;
  }[];
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const KIND_COLOUR: Record<EventDetail["event"]["kind"], string> = {
  TRIP: "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
  FUNCTION: "bg-pink-50 text-pink-700 dark:bg-pink-950/40 dark:text-pink-300",
  FESTIVAL: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  PROJECT: "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
  MEDICAL: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  OTHER: "bg-slate-50 text-slate-700 dark:bg-slate-950/40 dark:text-slate-300",
};

export default function EventDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { data: session } = useSession();
  const canWrite = hasPermission(session, "events", "full");
  const detailKey = `/api/events/${id}`;
  const { data, isLoading } = useSWR<EventDetail>(detailKey, fetcher);
  const [editOpen, setEditOpen] = useState(false);

  if (isLoading)
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!data?.event)
    return (
      <p className="text-sm text-muted-foreground">
        Event not found.{" "}
        <Link href="/events" className="underline">
          Back to events
        </Link>
      </p>
    );

  const { event, totalSpent, breakdown, memberSplits, transactions } = data;
  const dateLabel =
    event.endedAt && event.endedAt !== event.startedAt
      ? `${formatDate(event.startedAt)} – ${formatDate(event.endedAt)}`
      : formatDate(event.startedAt);
  const budgetRemaining =
    event.budget != null ? event.budget - totalSpent : null;
  const contributorCount = memberSplits.length;

  async function archive(toggle: boolean) {
    const res = await fetch(`/api/events/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active: toggle }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(body.error ?? "Failed");
      return;
    }
    toast.success(toggle ? "Restored" : "Archived");
    globalMutate(detailKey);
    globalMutate((k) => typeof k === "string" && k.startsWith("/api/events"));
  }

  async function remove() {
    if (
      !confirm(
        "Delete this event? Linked transactions stay; only the event grouping is removed.",
      )
    )
      return;
    const res = await fetch(`/api/events/${id}`, { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(body.error ?? "Failed to delete");
      return;
    }
    toast.success("Event deleted");
    globalMutate((k) => typeof k === "string" && k.startsWith("/api/events"));
    router.push("/events");
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/events"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> All events
        </Link>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${KIND_COLOUR[event.kind]}`}
              >
                {event.kind}
              </span>
              {!event.active && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  Archived
                </span>
              )}
            </div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight truncate">
              {event.name}
            </h1>
            <p className="text-sm text-muted-foreground">{dateLabel}</p>
            {event.notes && (
              <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">
                {event.notes}
              </p>
            )}
          </div>
          {canWrite && (
            <div className="flex items-center gap-1 shrink-0">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEditOpen(true)}
                className="gap-1"
              >
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => archive(!event.active)}
                className="gap-1"
                title={event.active ? "Archive" : "Restore"}
              >
                {event.active ? (
                  <>
                    <Archive className="h-3.5 w-3.5" /> Archive
                  </>
                ) : (
                  <>
                    <ArchiveRestore className="h-3.5 w-3.5" /> Restore
                  </>
                )}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={remove}
                title="Delete event"
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Total expense"
          value={formatINR(totalSpent)}
          hint="Sum of expense transactions tagged to this event. Income / refunds shown below but excluded."
        />
        <Stat
          label="Budget"
          value={event.budget != null ? formatINR(event.budget) : "—"}
        />
        <Stat
          label={
            budgetRemaining != null && budgetRemaining < 0
              ? "Over budget"
              : "Remaining"
          }
          value={
            budgetRemaining != null
              ? formatINR(Math.abs(budgetRemaining))
              : "—"
          }
          tone={
            budgetRemaining != null && budgetRemaining < 0
              ? "negative"
              : "default"
          }
        />
        <Stat
          label="Transactions"
          value={String(transactions.length)}
          hint={
            contributorCount > 0
              ? `${contributorCount} owe${contributorCount === 1 ? "s" : ""}`
              : undefined
          }
        />
      </div>

      <Section title="Breakdown by category">
        {breakdown.length === 0 ? (
          <Empty msg="No spend yet. Tag a transaction to this event from the transaction dialog." />
        ) : (
          <div className="rounded-xl border bg-card divide-y">
            {breakdown.map((row) => {
              const pct =
                totalSpent > 0 ? Math.round((row.total / totalSpent) * 100) : 0;
              return (
                <div
                  key={row.categoryId ?? "__none__"}
                  className="px-4 py-3 text-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">{row.label}</span>
                    <span className="font-medium tabular-nums">
                      {formatINR(row.total)}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full bg-primary"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-muted-foreground tabular-nums w-9 text-right">
                      {pct}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <Section title="Member splits">
        {memberSplits.length === 0 ? (
          <Empty msg="No splits tracked. Mark a transaction as 'Recoverable' for a contact in the transaction dialog to track who owes back." />
        ) : (
          <div className="rounded-xl border bg-card divide-y">
            {memberSplits.map((s) => (
              <div
                key={s.contactId}
                className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
              >
                <Link
                  href={`/contacts/${s.contactId}`}
                  className="font-medium hover:underline"
                >
                  {s.contactName}
                </Link>
                <div className="text-right">
                  <div
                    className={`font-medium tabular-nums ${s.owes > 0 ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400"}`}
                  >
                    {s.owes > 0
                      ? `owes ${formatINR(s.owes)}`
                      : "settled"}
                  </div>
                  {s.settled > 0 && (
                    <div className="text-[10px] text-muted-foreground">
                      {formatINR(s.settled)} settled
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title={`Transactions (${transactions.length})`}>
        {transactions.length === 0 ? (
          <Empty msg="No transactions tagged yet." />
        ) : (
          <div className="rounded-xl border bg-card divide-y">
            {transactions.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate">{t.description}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatDate(t.date)} · {t.categoryLabel}
                  </div>
                </div>
                <div
                  className={`font-medium tabular-nums shrink-0 ${t.type === "INCOME" ? "text-emerald-700 dark:text-emerald-400" : ""}`}
                >
                  {t.type === "INCOME" ? "+" : ""}
                  {formatINR(t.amount)}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Documents">
        <AttachmentList
          ownerKind="EVENT_DOCUMENT"
          ownerId={id}
          emptyMessage="No documents yet. Upload itineraries, hotel confirmations, wedding invitations — anything event-level."
          accept="image/*,application/pdf"
        />
      </Section>

      <EventDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        event={{
          id: event.id,
          name: event.name,
          kind: event.kind,
          startedAt: event.startedAt,
          endedAt: event.endedAt,
          notes: event.notes,
          budget: event.budget,
        }}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "negative";
}) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={`mt-1 text-base font-semibold tabular-nums ${
          tone === "negative" ? "text-destructive" : ""
        }`}
      >
        {value}
      </div>
      {hint && (
        <div className="mt-0.5 text-[10px] text-muted-foreground">{hint}</div>
      )}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return (
    <div className="rounded-xl border bg-card p-4 text-xs text-muted-foreground">
      {msg}
    </div>
  );
}
