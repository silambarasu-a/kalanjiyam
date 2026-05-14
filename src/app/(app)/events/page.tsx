"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import useSWR from "swr";
import { Calendar, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { EventDialog } from "@/components/events/event-dialog";
import { hasPermission } from "@/lib/permissions";
import { formatINR, formatDate } from "@/lib/utils";

type EventRow = {
  id: string;
  name: string;
  kind: "TRIP" | "FUNCTION" | "FESTIVAL" | "PROJECT" | "MEDICAL" | "OTHER";
  startedAt: string;
  endedAt: string | null;
  budget: number | null;
  active: boolean;
  totalSpent: number;
  txnCount: number;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const KIND_LABEL: Record<EventRow["kind"], string> = {
  TRIP: "Trip",
  FUNCTION: "Function",
  FESTIVAL: "Festival",
  PROJECT: "Project",
  MEDICAL: "Medical",
  OTHER: "Other",
};

const KIND_COLOUR: Record<EventRow["kind"], string> = {
  TRIP: "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
  FUNCTION: "bg-pink-50 text-pink-700 dark:bg-pink-950/40 dark:text-pink-300",
  FESTIVAL: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  PROJECT: "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
  MEDICAL: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  OTHER: "bg-slate-50 text-slate-700 dark:bg-slate-950/40 dark:text-slate-300",
};

export default function EventsPage() {
  const { data: session } = useSession();
  const canWrite = hasPermission(session, "events", "full");
  const [status, setStatus] = useState<"active" | "all">("active");
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<"" | EventRow["kind"]>("");
  const [sort, setSort] = useState<"newest" | "spend">("newest");
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data, isLoading } = useSWR<{ events: EventRow[] }>(
    `/api/events?status=${status}`,
    fetcher,
  );

  const events = useMemo(() => {
    let list = data?.events ?? [];
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((e) => e.name.toLowerCase().includes(q));
    }
    if (kindFilter) {
      list = list.filter((e) => e.kind === kindFilter);
    }
    if (sort === "spend") {
      list = [...list].sort((a, b) => b.totalSpent - a.totalSpent);
    }
    return list;
  }, [data, search, kindFilter, sort]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Calendar className="h-5 w-5 text-primary" /> Events &amp; Trips
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Tag transactions to a trip, function, festival, project or medical
            episode — see the full bill across categories in one place.
          </p>
        </div>
        {canWrite && (
          <Button onClick={() => setDialogOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" /> New event
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name…"
            className="pl-8"
          />
        </div>
        <NativeSelect
          value={kindFilter}
          onChange={(v) => setKindFilter(v as typeof kindFilter)}
          options={[
            { value: "", label: "All kinds" },
            ...Object.entries(KIND_LABEL).map(([v, l]) => ({
              value: v,
              label: l,
            })),
          ]}
        />
        <NativeSelect
          value={status}
          onChange={(v) => setStatus(v as "active" | "all")}
          options={[
            { value: "active", label: "Active" },
            { value: "all", label: "Active + Archived" },
          ]}
        />
        <NativeSelect
          value={sort}
          onChange={(v) => setSort(v as "newest" | "spend")}
          options={[
            { value: "newest", label: "Newest first" },
            { value: "spend", label: "Highest spend" },
          ]}
        />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="rounded-xl border bg-card p-5 animate-pulse h-32"
            />
          ))}
        </div>
      ) : events.length === 0 ? (
        <div className="rounded-xl border bg-card p-10 text-center space-y-3">
          <div className="mx-auto h-10 w-10 rounded-full bg-muted flex items-center justify-center">
            <Calendar className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <h2 className="text-base font-medium">No events yet</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Tag transactions to a trip / function / festival to see the full
              bill grouped here. Useful for &ldquo;How much did Tirupati cost?&rdquo; or
              &ldquo;What did Vidya&rsquo;s wedding total?&rdquo;
            </p>
          </div>
          {canWrite && (
            <Button onClick={() => setDialogOpen(true)} className="gap-2 mt-2">
              <Plus className="h-4 w-4" /> Create your first event
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {events.map((e) => (
            <EventCard key={e.id} event={e} />
          ))}
        </div>
      )}

      <EventDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </div>
  );
}

function EventCard({ event }: { event: EventRow }) {
  const dateLabel =
    event.endedAt && event.endedAt !== event.startedAt
      ? `${formatDate(event.startedAt)} – ${formatDate(event.endedAt)}`
      : formatDate(event.startedAt);
  const budgetPct =
    event.budget && event.budget > 0
      ? Math.min(100, Math.round((event.totalSpent / event.budget) * 100))
      : null;
  const budgetTone =
    budgetPct == null
      ? ""
      : budgetPct >= 90
        ? "bg-red-500"
        : budgetPct >= 70
          ? "bg-amber-500"
          : "bg-emerald-500";

  return (
    <Link
      href={`/events/${event.id}`}
      className="group rounded-xl border bg-card p-4 hover:bg-muted/40 transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${KIND_COLOUR[event.kind]}`}
            >
              {KIND_LABEL[event.kind]}
            </span>
            {!event.active && (
              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                Archived
              </span>
            )}
          </div>
          <h3 className="mt-1.5 font-semibold truncate group-hover:text-primary">
            {event.name}
          </h3>
          <p className="text-xs text-muted-foreground">{dateLabel}</p>
        </div>
      </div>
      <div className="mt-3 flex items-baseline justify-between gap-2">
        <div>
          <div className="text-lg font-semibold tabular-nums">
            {formatINR(event.totalSpent)}
          </div>
          <div className="text-[10px] text-muted-foreground">
            {event.txnCount} transaction{event.txnCount === 1 ? "" : "s"}
          </div>
        </div>
        {event.budget != null && (
          <div className="text-right">
            <div className="text-xs text-muted-foreground tabular-nums">
              of {formatINR(event.budget)}
            </div>
          </div>
        )}
      </div>
      {event.budget != null && budgetPct != null && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full ${budgetTone}`}
            style={{ width: `${budgetPct}%` }}
          />
        </div>
      )}
    </Link>
  );
}
