"use client";

import Link from "next/link";
import useSWR from "swr";
import { Bell, X, CheckCheck, Undo2 } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn, formatINR, formatDate } from "@/lib/utils";
import { useDismissedNotifications } from "@/lib/use-dismissed-notifications";

type Item = {
  id: string;
  source: "REMINDER" | "LOAN" | "LEASE" | "CARD_STATEMENT";
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

const fetcher = (url: string) =>
  fetch(url).then((r) =>
    r.ok
      ? r.json()
      : { items: [], counts: { total: 0, overdue: 0, dueSoon: 0 } },
  );

export function NotificationsPopover() {
  const { data } = useSWR<Payload>("/api/notifications", fetcher, {
    refreshInterval: 60_000,
  });
  const { isDismissed, dismiss, dismissMany, undismiss, clearAll } =
    useDismissedNotifications();

  const allItems = data?.items ?? [];
  const unreadItems = allItems.filter((i) => !isDismissed(i.id, i.dueDate));
  // Bell badge + header counts reflect unread only — read items stay
  // listed but don't count.
  const overdue = unreadItems.filter((i) => i.overdue).length;
  const total = unreadItems.length;
  const dueSoon = total - overdue;
  const readCount = allItems.length - unreadItems.length;
  // Sort unread first (chronological), then read (chronological). Keeps
  // actionable items at the top of the constrained popover surface.
  const orderedItems = [
    ...unreadItems,
    ...allItems.filter((i) => isDismissed(i.id, i.dueDate)),
  ];

  return (
    <Popover>
      <PopoverTrigger
        aria-label={
          total > 0
            ? `Notifications — ${total}${overdue > 0 ? `, ${overdue} overdue` : ""}`
            : "Notifications"
        }
        title={
          total > 0
            ? `${total} due${overdue > 0 ? ` (${overdue} overdue)` : ""}`
            : "No notifications"
        }
        className="relative h-9 w-9 rounded-md hover:bg-accent flex items-center justify-center text-muted-foreground transition-colors"
      >
        <Bell className="h-4 w-4" />
        {total > 0 && (
          <span
            aria-hidden
            style={{ top: "0.3rem", right: "0.35rem" }}
            className={cn(
              "pointer-events-none absolute h-2.5 w-2.5 rounded-full border-2 border-background shadow-sm",
              overdue > 0 ? "bg-destructive" : "bg-primary",
            )}
          />
        )}
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-80 p-0 gap-0">
        <div className="px-4 py-3 border-b">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-sm">Notifications</span>
            <div className="flex items-center gap-1">
              {total > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    dismissMany(
                      unreadItems.map((i) => ({
                        id: i.id,
                        dueDate: i.dueDate,
                      })),
                    )
                  }
                  title="Mark all as read"
                  aria-label="Mark all as read"
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                >
                  <CheckCheck className="h-3 w-3" /> Mark all read
                </button>
              )}
              {readCount > 0 && total === 0 && (
                <button
                  type="button"
                  onClick={clearAll}
                  title="Mark all unread"
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                >
                  <Undo2 className="h-3 w-3" /> Restore
                </button>
              )}
              <Link
                href="/notifications"
                className="rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                View all
              </Link>
            </div>
          </div>
          {(total > 0 || readCount > 0) && (
            <div className="mt-0.5 text-xs text-muted-foreground">
              {overdue > 0 && (
                <span className="text-destructive font-medium">
                  {overdue} overdue
                </span>
              )}
              {overdue > 0 && dueSoon > 0 && " · "}
              {dueSoon > 0 && <span>{dueSoon} unread</span>}
              {(total > 0) && readCount > 0 && " · "}
              {readCount > 0 && <span>{readCount} read</span>}
            </div>
          )}
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {orderedItems.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              All caught up.
            </div>
          ) : (
            <ul className="divide-y">
              {orderedItems.slice(0, 12).map((it) => {
                const dismissed = isDismissed(it.id, it.dueDate);
                return (
                  <li
                    key={`${it.id}|${it.dueDate}`}
                    className="group relative hover:bg-accent transition-colors"
                  >
                    <Link
                      href={it.href}
                      onClick={() => {
                        if (!dismissed) dismiss(it.id, it.dueDate);
                      }}
                      className={cn(
                        "block px-4 py-2.5 pr-10",
                        dismissed && "opacity-55",
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <div
                          className={cn(
                            "mt-1 h-1.5 w-1.5 shrink-0 rounded-full",
                            dismissed
                              ? "bg-muted-foreground/40"
                              : it.overdue
                                ? "bg-destructive"
                                : "bg-primary",
                          )}
                        />
                        <div className="flex-1 min-w-0">
                          <div
                            className={cn(
                              "text-sm truncate",
                              dismissed ? "font-normal" : "font-medium",
                            )}
                          >
                            {it.label}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {sourceLabel(it.source)} · {formatDate(it.dueDate)}
                            {it.overdue && !dismissed ? " · overdue" : ""}
                            {dismissed ? " · read" : ""}
                          </div>
                        </div>
                        {it.amount != null && (
                          <div className="text-sm font-semibold tabular-nums shrink-0">
                            {formatINR(it.amount)}
                          </div>
                        )}
                      </div>
                    </Link>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (dismissed) undismiss(it.id, it.dueDate);
                        else dismiss(it.id, it.dueDate);
                      }}
                      title={dismissed ? "Mark as unread" : "Mark as read"}
                      aria-label={dismissed ? "Mark as unread" : "Mark as read"}
                      className="absolute top-1/2 right-2 -translate-y-1/2 h-6 w-6 rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-background hover:text-foreground transition-opacity flex items-center justify-center"
                    >
                      {dismissed ? (
                        <Undo2 className="h-3.5 w-3.5" />
                      ) : (
                        <X className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {orderedItems.length > 12 && (
          <div className="border-t px-4 py-2 text-center">
            <Link
              href="/notifications"
              className="text-xs font-medium text-primary hover:underline"
            >
              {orderedItems.length - 12} more
            </Link>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function sourceLabel(s: Item["source"]): string {
  switch (s) {
    case "REMINDER":
      return "Reminder";
    case "LOAN":
      return "Loan EMI";
    case "LEASE":
      return "Lease";
    case "CARD_STATEMENT":
      return "Card bill";
  }
}
