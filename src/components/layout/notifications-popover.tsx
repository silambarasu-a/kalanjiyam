"use client";

import Link from "next/link";
import useSWR from "swr";
import { Bell, X, CheckCheck, Undo2, Wallet, CheckCircle2 } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn, formatINR, formatDate } from "@/lib/utils";
import { useDismissedNotifications } from "@/lib/use-dismissed-notifications";

type Item = {
  id: string;
  source: "REMINDER" | "LOAN" | "LEASE" | "CARD_STATEMENT" | "INBOX";
  kind: string;
  label: string;
  dueDate: string;
  amount: number | null;
  total?: number;
  paid?: number;
  href: string;
  payHref?: string;
  overdue: boolean;
};
type Payload = {
  items: Item[];
  counts: { total: number; overdue: number; dueSoon: number };
};

type InboxNotification = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
};
type InboxPayload = { notifications: InboxNotification[] };

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
  // Persistent inbox unread count (Phase 7 — separate from the
  // computed dues feed above). The bell badge combines both so a single
  // surface signals everything actionable.
  const { data: inbox } = useSWR<{ count: number }>(
    "/api/inbox/unread-count",
    (url: string) => fetch(url).then((r) => (r.ok ? r.json() : { count: 0 })),
    { refreshInterval: 60_000 },
  );
  const inboxUnread = inbox?.count ?? 0;
  // Pull the persisted Notification rows themselves so events that don't
  // have a corresponding computed-due (e.g. "Statement generated",
  // claim status changes, policy renewal heads-up) actually appear in
  // the bell popover, not just in /inbox.
  const { data: inboxList } = useSWR<InboxPayload>(
    "/api/inbox?filter=unread&take=20",
    (url: string) =>
      fetch(url).then((r) => (r.ok ? r.json() : { notifications: [] })),
    { refreshInterval: 60_000 },
  );
  const { isDismissed, dismiss, dismissMany, undismiss, clearAll } =
    useDismissedNotifications();

  const dueItems = data?.items ?? [];
  // Convert each unread Notification row into the same Item shape as
  // the dues feed so a single rendering path handles both. Each inbox
  // kind that has an equivalent computed-due source is then deduped
  // against the active dues list — otherwise the user sees two rows
  // (one event row, one status row) referring to the same thing.
  const inboxItems: Item[] = (inboxList?.notifications ?? []).map((n) => ({
    id: `inbox:${n.id}`,
    source: "INBOX",
    kind: n.kind,
    label: n.title,
    dueDate: n.createdAt,
    amount: null,
    href: n.link ?? "/inbox",
    overdue: false,
  }));
  // Mapping of inbox NotificationKind → the equivalent computed-due
  // source. Kinds NOT in this map (POLICY_RENEWING, CLAIM_STATUS_CHANGED,
  // GENERIC, etc.) have no computed-due counterpart and always show.
  const INBOX_KIND_DEDUP_SOURCES: Record<string, Item["source"][]> = {
    CARD_STATEMENT_DUE: ["CARD_STATEMENT"],
    LOAN_EMI_DUE: ["LOAN"],
    PREMIUM_DUE_SOON: ["REMINDER"],
    PREMIUM_OVERDUE: ["REMINDER"],
  };
  const filteredInbox = inboxItems.filter((i) => {
    const dedupSources = INBOX_KIND_DEDUP_SOURCES[i.kind];
    if (!dedupSources) return true;
    const inboxLabel = i.label.toLowerCase();
    return !dueItems.some(
      (d) =>
        dedupSources.includes(d.source) &&
        d.label &&
        inboxLabel.includes(d.label.toLowerCase()),
    );
  });
  const allItems: Item[] = [...dueItems, ...filteredInbox];
  const unreadItems = allItems.filter((i) => !isDismissed(i.id, i.dueDate));
  // Bell badge + header counts reflect unread only — read items stay
  // listed but don't count.
  const overdue = unreadItems.filter((i) => i.overdue).length;
  const total = unreadItems.length;
  const dueSoon = total - overdue;
  const readCount = allItems.length - unreadItems.length;
  // Bell badge sums dues + inbox so a single dot covers both surfaces.
  const badgeTotal = total + inboxUnread;
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
        {badgeTotal > 0 && (
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
              {inboxUnread > 0 && (
                <Link
                  href="/inbox"
                  className="rounded-md bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/20 transition-colors"
                  title="Open inbox"
                >
                  Inbox ({inboxUnread})
                </Link>
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
                const canPay = it.payHref != null && (it.amount ?? 0) > 0;
                const isPaid =
                  (it.amount ?? 0) === 0 &&
                  it.total != null &&
                  it.paid != null &&
                  it.paid >= it.total;
                return (
                  <li
                    key={`${it.id}|${it.dueDate}`}
                    className="group relative hover:bg-accent transition-colors"
                  >
                    {/* Main row: details + amount on the left, Pay column
                        as a sibling on the right (separate <a>, not nested
                        inside the row link). */}
                    <div className="flex items-stretch">
                      <Link
                        href={it.href}
                        onClick={() => {
                          if (!dismissed) dismiss(it.id, it.dueDate);
                        }}
                        className={cn(
                          "min-w-0 flex-1 block px-4 py-2.5 pr-7",
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
                              {it.total != null &&
                                it.paid != null &&
                                it.paid > 0 && (
                                  <>
                                    {" · "}
                                    <span className="text-emerald-700 dark:text-emerald-400">
                                      {formatINR(it.paid)} paid
                                    </span>{" "}
                                    of {formatINR(it.total)}
                                  </>
                                )}
                            </div>
                          </div>
                          {it.amount != null && (
                            <div className="text-sm font-semibold tabular-nums shrink-0">
                              {formatINR(it.amount)}
                            </div>
                          )}
                        </div>
                      </Link>
                      {isPaid ? (
                        <span
                          title="Paid"
                          aria-label="Paid"
                          className="shrink-0 flex items-center gap-1 self-stretch border-l px-3 text-[11px] font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-50/70 dark:bg-emerald-900/20"
                        >
                          <CheckCircle2 className="h-3 w-3" /> Paid
                        </span>
                      ) : (
                        canPay &&
                        it.payHref && (
                          <Link
                            href={it.payHref}
                            onClick={() => {
                              if (!dismissed) dismiss(it.id, it.dueDate);
                            }}
                            title="Pay / confirm"
                            aria-label="Pay / confirm"
                            className="shrink-0 flex items-center gap-1 self-stretch border-l px-3 text-[11px] font-medium text-primary hover:bg-primary hover:text-primary-foreground transition-colors"
                          >
                            <Wallet className="h-3 w-3" /> Pay
                          </Link>
                        )
                      )}
                    </div>
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
                      className="absolute top-1 right-1 z-10 h-5 w-5 rounded-md bg-card/90 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-background hover:text-foreground transition-opacity flex items-center justify-center"
                    >
                      {dismissed ? (
                        <Undo2 className="h-3 w-3" />
                      ) : (
                        <X className="h-3 w-3" />
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
    case "INBOX":
      return "Notification";
  }
}
