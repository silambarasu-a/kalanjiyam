"use client";

import { useState } from "react";
import useSWR from "swr";
import { Download, FileText, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatINR, formatDate } from "@/lib/utils";
import { fetcher } from "@/lib/swr-fetcher";

/**
 * "Attachments" tab on a contact's page. Aggregates every receipt attached
 * to a transaction that involves this contact (charges, shared-expense
 * splits, and expenses they paid), grouped under its transaction so the
 * money context stays visible. Downloads mint a fresh presigned URL on
 * demand; "View" opens the full transaction detail (with inline previews).
 */

type AttachmentRow = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  uploadedBy: { id: string; name: string } | null;
};

type TxnGroup = {
  id: string;
  type: string;
  amount: number;
  description: string;
  date: string;
  attachments: AttachmentRow[];
};

export function ContactAttachmentsPanel({
  contactId,
  onViewTransaction,
}: {
  contactId: string;
  onViewTransaction: (transactionId: string) => void;
}) {
  const { data, isLoading, error } = useSWR<{
    count: number;
    transactions: TxnGroup[];
  }>(contactId ? `/api/contacts/${contactId}/attachments` : null, fetcher);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  async function handleDownload(attachmentId: string) {
    setDownloadingId(attachmentId);
    try {
      const res = await fetch(`/api/attachments/${attachmentId}/url`);
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.url) {
        window.open(body.url, "_blank", "noopener,noreferrer");
      }
    } finally {
      setDownloadingId(null);
    }
  }

  const groups = data?.transactions ?? [];

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Every receipt and supporting document attached to a transaction that
        involves this contact.
      </p>

      {error && (
        <div className="rounded-lg border bg-card px-5 py-8 text-center text-sm text-destructive">
          Could not load attachments.
        </div>
      )}

      {isLoading && !data && (
        <div className="rounded-lg border bg-card px-5 py-8 text-center text-sm text-muted-foreground">
          Loading…
        </div>
      )}

      {!isLoading && !error && groups.length === 0 && (
        <div className="rounded-lg border bg-card px-5 py-10 text-center text-sm text-muted-foreground">
          No attachments yet. Receipts uploaded on this contact&apos;s
          transactions will appear here.
        </div>
      )}

      {groups.length > 0 && (
        <div className="space-y-3">
          {groups.map((g) => (
            <div key={g.id} className="rounded-lg border bg-card overflow-hidden">
              <div className="flex items-center gap-3 border-b bg-muted/20 px-4 py-2.5">
                <Receipt className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {g.description}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {formatDate(g.date)} · {g.type.toLowerCase()} ·{" "}
                    {g.attachments.length} file
                    {g.attachments.length === 1 ? "" : "s"}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-sm font-semibold tabular-nums">
                    {formatINR(g.amount)}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => onViewTransaction(g.id)}
                  >
                    View
                  </Button>
                </div>
              </div>
              <ul className="divide-y">
                {g.attachments.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center justify-between gap-3 px-4 py-2.5"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium">
                          {a.filename}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {humanSize(a.sizeBytes)} · {formatDate(a.uploadedAt)}
                          {a.uploadedBy ? ` · by ${a.uploadedBy.name}` : ""}
                        </div>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="shrink-0"
                      onClick={() => handleDownload(a.id)}
                      disabled={downloadingId === a.id}
                      title="Download"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
