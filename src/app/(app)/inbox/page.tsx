"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { CheckCheck, Inbox, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";

type Notification = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function InboxPage() {
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const url = `/api/inbox${filter === "unread" ? "?filter=unread" : ""}`;
  const { data, isLoading } = useSWR<{ notifications: Notification[] }>(
    url,
    fetcher,
  );
  const rows = data?.notifications ?? [];
  const unreadCount = rows.filter((n) => !n.readAt).length;

  async function markRead(id: string) {
    await fetch(`/api/inbox/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ read: true }),
    });
    globalMutate(url);
    globalMutate("/api/inbox/unread-count");
  }

  async function markAllRead() {
    await fetch("/api/inbox", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "mark-all-read" }),
    });
    globalMutate(url);
    globalMutate("/api/inbox/unread-count");
  }

  async function remove(id: string) {
    await fetch(`/api/inbox/${id}`, { method: "DELETE" });
    globalMutate(url);
    globalMutate("/api/inbox/unread-count");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Persistent notifications — premium dues, claim status changes, policy
            renewals. Click through to the relevant page; mark read when handled.
          </p>
        </div>
        {unreadCount > 0 && (
          <Button onClick={markAllRead} size="sm" variant="outline" className="gap-2">
            <CheckCheck className="h-4 w-4" /> Mark all read
          </Button>
        )}
      </div>

      <div className="flex gap-2 border-b">
        {(["all", "unread"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setFilter(v)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm transition ${
              filter === v
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {v === "all" ? "All" : `Unread${unreadCount > 0 ? ` (${unreadCount})` : ""}`}
          </button>
        ))}
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!isLoading && rows.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border bg-card p-10 text-sm text-muted-foreground">
          <Inbox className="h-6 w-6" />
          {filter === "unread" ? "No unread notifications." : "Inbox is empty."}
        </div>
      )}

      <div className="rounded-lg border bg-card divide-y">
        {rows.map((n) => (
          <Row key={n.id} n={n} onMarkRead={markRead} onRemove={remove} />
        ))}
      </div>
    </div>
  );
}

function Row({
  n,
  onMarkRead,
  onRemove,
}: {
  n: Notification;
  onMarkRead: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const unread = !n.readAt;
  const body = (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2">
        {unread && (
          <span
            aria-hidden
            className="h-2 w-2 shrink-0 rounded-full bg-primary"
            title="Unread"
          />
        )}
        <span className={unread ? "font-medium" : ""}>{n.title}</span>
      </div>
      {n.body && (
        <div className="mt-0.5 text-xs text-muted-foreground">{n.body}</div>
      )}
      <div className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        {formatDate(n.createdAt)} · {n.kind.replace("_", " ").toLowerCase()}
      </div>
    </div>
  );
  return (
    <div className="flex items-start gap-3 p-4">
      {n.link ? (
        <Link
          href={n.link}
          onClick={() => unread && onMarkRead(n.id)}
          className="flex-1 min-w-0"
        >
          {body}
        </Link>
      ) : (
        <div className="flex-1 min-w-0">{body}</div>
      )}
      <div className="flex items-center gap-1">
        {unread && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onMarkRead(n.id)}
            title="Mark read"
          >
            <CheckCheck className="h-4 w-4" />
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onRemove(n.id)}
          title="Dismiss"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
