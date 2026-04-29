"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import {
  AlertTriangle,
  Bell,
  CheckCheck,
  ChevronRight,
  ExternalLink,
  Undo2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, formatDate, formatINR } from "@/lib/utils";
import { useDismissedNotifications } from "@/lib/use-dismissed-notifications";

type Source = "REMINDER" | "LOAN" | "LEASE";
type Item = {
  id: string;
  source: Source;
  kind: string;
  label: string;
  dueDate: string;
  amount: number | null;
  href: string;
  overdue: boolean;
};
type Payload = {
  items: Item[];
  counts: { total: number; overdue: number; dueSoon: number };
};

type FilterTab = "all" | "unread" | "overdue" | "read";
type SourceFilter = "all" | Source;

const fetcher = (url: string) =>
  fetch(url).then((r) =>
    r.ok
      ? r.json()
      : { items: [], counts: { total: 0, overdue: 0, dueSoon: 0 } },
  );

export default function NotificationsPage() {
  const [windowDays, setWindowDays] = useState<30 | 90 | 365>(90);
  const { data, isLoading } = useSWR<Payload>(
    `/api/notifications?days=${windowDays}`,
    fetcher,
  );
  const { isDismissed, dismiss, dismissMany, undismiss, clearAll } =
    useDismissedNotifications();

  const [tab, setTab] = useState<FilterTab>("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");

  const allItems = useMemo<Item[]>(() => data?.items ?? [], [data]);
  const counts = useMemo(() => {
    const unread = allItems.filter((i) => !isDismissed(i.id, i.dueDate));
    const overdueUnread = unread.filter((i) => i.overdue);
    return {
      all: allItems.length,
      unread: unread.length,
      overdue: overdueUnread.length,
      read: allItems.length - unread.length,
    };
  }, [allItems, isDismissed]);

  const filtered = useMemo(() => {
    return allItems.filter((i) => {
      const dismissed = isDismissed(i.id, i.dueDate);
      const tabOk =
        tab === "all"
          ? true
          : tab === "unread"
            ? !dismissed
            : tab === "overdue"
              ? !dismissed && i.overdue
              : dismissed;
      const sourceOk = sourceFilter === "all" || i.source === sourceFilter;
      return tabOk && sourceOk;
    });
  }, [allItems, tab, sourceFilter, isDismissed]);

  const grouped = useMemo(() => groupByDay(filtered), [filtered]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Loan EMIs, lease payments, and investment reminders due in the next{" "}
            {windowDays} days. Mark items as read when you've handled them or
            don't need a nudge.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {([30, 90, 365] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setWindowDays(d)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                windowDays === d
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {d === 365 ? "1 year" : `${d} days`}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Unread" value={String(counts.unread)} highlight />
        <Stat
          label="Overdue"
          value={String(counts.overdue)}
          tone={counts.overdue > 0 ? "destructive" : "default"}
        />
        <Stat label="Read" value={String(counts.read)} />
        <Stat label="Total in window" value={String(counts.all)} />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b">
        {(
          [
            ["all", "All", counts.all],
            ["unread", "Unread", counts.unread],
            ["overdue", "Overdue", counts.overdue],
            ["read", "Read", counts.read],
          ] as [FilterTab, string, number][]
        ).map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              "relative -mb-px px-3 py-2 text-sm font-medium transition-colors border-b-2",
              tab === key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
            <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
              {count}
            </span>
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2 pb-1">
          <SourceSelect value={sourceFilter} onChange={setSourceFilter} />
          {tab !== "read" && counts.unread > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() =>
                dismissMany(
                  allItems
                    .filter((i) => !isDismissed(i.id, i.dueDate))
                    .map((i) => ({ id: i.id, dueDate: i.dueDate })),
                )
              }
            >
              <CheckCheck className="h-3.5 w-3.5" /> Mark all read
            </Button>
          )}
          {tab === "read" && counts.read > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={clearAll}
            >
              <Undo2 className="h-3.5 w-3.5" /> Restore all
            </Button>
          )}
        </div>
      </div>

      {isLoading && !data ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : filtered.length === 0 ? (
        <EmptyState tab={tab} />
      ) : (
        <div className="space-y-5">
          {grouped.map(({ key, label, items }) => (
            <section key={key}>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                {label}
              </h2>
              <div className="rounded-lg border bg-card divide-y">
                {items.map((it) => {
                  const dismissed = isDismissed(it.id, it.dueDate);
                  return (
                    <div
                      key={`${it.id}|${it.dueDate}`}
                      className={cn(
                        "flex items-center gap-3 px-5 py-3",
                        dismissed && "opacity-60",
                      )}
                    >
                      <div
                        className={cn(
                          "h-2 w-2 shrink-0 rounded-full",
                          it.overdue && !dismissed
                            ? "bg-destructive"
                            : dismissed
                              ? "bg-muted-foreground/40"
                              : "bg-primary",
                        )}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            {sourceLabel(it.source)}
                          </span>
                          {it.overdue && !dismissed && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive">
                              <AlertTriangle className="h-2.5 w-2.5" /> Overdue
                            </span>
                          )}
                        </div>
                        <div className="text-sm font-medium truncate">
                          {it.label}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Due {formatDate(it.dueDate)}
                        </div>
                      </div>
                      {it.amount != null && (
                        <div className="text-sm font-semibold tabular-nums shrink-0">
                          {formatINR(it.amount)}
                        </div>
                      )}
                      <Link
                        href={it.href}
                        onClick={() => {
                          if (!dismissed) dismiss(it.id, it.dueDate);
                        }}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                      >
                        Open <ExternalLink className="h-3 w-3" />
                      </Link>
                      {dismissed ? (
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Restore"
                          title="Restore"
                          onClick={() => undismiss(it.id, it.dueDate)}
                        >
                          <Undo2 className="h-3.5 w-3.5" />
                        </Button>
                      ) : (
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Mark as read"
                          title="Mark as read"
                          onClick={() => dismiss(it.id, it.dueDate)}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "default",
  highlight,
}: {
  label: string;
  value: string;
  tone?: "default" | "destructive";
  highlight?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "mt-1 font-semibold",
          highlight ? "text-2xl" : "text-lg",
          tone === "destructive" ? "text-destructive" : "text-foreground",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function SourceSelect({
  value,
  onChange,
}: {
  value: SourceFilter;
  onChange: (v: SourceFilter) => void;
}) {
  return (
    <select
      aria-label="Filter by source"
      value={value}
      onChange={(e) => onChange(e.target.value as SourceFilter)}
      className="h-8 rounded-md border bg-card px-2 text-xs"
    >
      <option value="all">All sources</option>
      <option value="LOAN">Loan EMIs</option>
      <option value="LEASE">Lease payments</option>
      <option value="REMINDER">Investment reminders</option>
    </select>
  );
}

function EmptyState({ tab }: { tab: FilterTab }) {
  const message =
    tab === "overdue"
      ? "Nothing overdue. Nice."
      : tab === "read"
        ? "Nothing read yet."
        : tab === "unread"
          ? "All caught up."
          : "No notifications in this window.";
  return (
    <div className="rounded-lg border bg-card px-6 py-16 text-center">
      <Bell className="mx-auto h-8 w-8 text-muted-foreground/50" />
      <p className="mt-3 text-sm text-muted-foreground">{message}</p>
      <Link
        href="/dashboard"
        className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
      >
        Back to dashboard <ChevronRight className="h-3 w-3" />
      </Link>
    </div>
  );
}

function sourceLabel(s: Source): string {
  switch (s) {
    case "REMINDER":
      return "Reminder";
    case "LOAN":
      return "Loan EMI";
    case "LEASE":
      return "Lease";
  }
}

function groupByDay(items: Item[]): {
  key: string;
  label: string;
  items: Item[];
}[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const weekEnd = new Date(today);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const buckets = new Map<string, { label: string; items: Item[] }>();
  for (const it of items) {
    const d = new Date(it.dueDate);
    let key: string, label: string;
    if (d < today) {
      key = "overdue";
      label = "Overdue";
    } else if (d < tomorrow) {
      key = "today";
      label = "Today";
    } else if (d.getTime() < tomorrow.getTime() + 24 * 60 * 60 * 1000) {
      key = "tomorrow";
      label = "Tomorrow";
    } else if (d < weekEnd) {
      key = "thisweek";
      label = "This week";
    } else {
      key = `m:${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      label = d.toLocaleDateString(undefined, {
        month: "long",
        year: "numeric",
      });
    }
    if (!buckets.has(key)) buckets.set(key, { label, items: [] });
    buckets.get(key)!.items.push(it);
  }
  // Preserve insertion order, which already follows the chronological sort
  // from the API.
  return Array.from(buckets, ([key, v]) => ({
    key,
    label: v.label,
    items: v.items,
  }));
}
