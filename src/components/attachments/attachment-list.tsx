"use client";

import { useRef, useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { Download, FileText, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";

/**
 * Workspace-scoped, owner-bound file list. Drop in anywhere a domain
 * row needs file uploads:
 *
 *   <AttachmentList ownerKind="VEHICLE_DOCUMENT" ownerId={doc.id} />
 *
 * Handles list + add + download + delete in a single component, hitting
 * the generic /api/attachments endpoints. The API enforces per-kind
 * MIME / size limits, so this component happily accepts everything.
 *
 * `accept` is purely a UX convenience for the file picker — server-side
 * policy is the source of truth.
 */

type AttachmentRow = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  uploadedBy: { id: string; name: string } | null;
};

type Props = {
  ownerKind: string;
  ownerId: string;
  /** Show the upload widget. Defaults to true. */
  canUpload?: boolean;
  /** Show the per-row delete button. Defaults to true. */
  canDelete?: boolean;
  /** Override the file picker `accept` attribute. */
  accept?: string;
  /** Compact "no attachments yet" empty state. */
  emptyMessage?: string;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function AttachmentList({
  ownerKind,
  ownerId,
  canUpload = true,
  canDelete = true,
  accept = "image/*,application/pdf",
  emptyMessage = "No files yet.",
}: Props) {
  const swrKey = `/api/attachments?ownerKind=${encodeURIComponent(ownerKind)}&ownerId=${encodeURIComponent(ownerId)}`;
  const { data, isLoading, error } = useSWR<{ attachments: AttachmentRow[] }>(
    ownerId ? swrKey : null,
    fetcher,
  );
  const items = data?.attachments ?? [];
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function uploadOne(file: File) {
    setErrorMsg(null);
    setUploading(true);
    try {
      // Step 1 — request a presigned PUT URL. Server decides the key.
      const upRes = await fetch("/api/attachments/upload-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ownerKind,
          ownerId,
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          size: file.size,
        }),
      });
      const upBody = await upRes.json().catch(() => ({}));
      if (!upRes.ok) {
        setErrorMsg(upBody.error ?? "Could not start upload");
        return;
      }
      // Step 2 — direct PUT to S3.
      const putRes = await fetch(upBody.url, {
        method: "PUT",
        headers: {
          "content-type": file.type || "application/octet-stream",
        },
        body: file,
      });
      if (!putRes.ok) {
        setErrorMsg(`Upload failed (${putRes.status})`);
        return;
      }
      // Step 3 — finalize: server re-verifies the key prefix and
      // writes the Attachment row tagged with the current user.
      const finRes = await fetch("/api/attachments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ownerKind,
          ownerId,
          s3Key: upBody.key,
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
        }),
      });
      const finBody = await finRes.json().catch(() => ({}));
      if (!finRes.ok) {
        setErrorMsg(finBody.error ?? "Could not finalize upload");
        return;
      }
      globalMutate(swrKey);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    // Sequential to keep error messages attributable to a single file.
    for (const f of Array.from(files)) {
      await uploadOne(f);
    }
  }

  async function handleDownload(id: string) {
    setErrorMsg(null);
    const res = await fetch(`/api/attachments/${id}/url`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErrorMsg(body.error ?? "Could not generate download URL");
      return;
    }
    window.open(body.url, "_blank", "noopener,noreferrer");
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this file? The attachment will be removed.")) return;
    setErrorMsg(null);
    const res = await fetch(`/api/attachments/${id}`, { method: "DELETE" });
    if (res.ok) {
      globalMutate(swrKey);
    } else {
      const body = await res.json().catch(() => ({}));
      setErrorMsg(body.error ?? "Failed to delete attachment");
    }
  }

  return (
    <div className="space-y-2">
      {canUpload && (
        <div>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={accept}
            onChange={(e) => handleFiles(e.target.files)}
            className="block w-full text-xs file:mr-2 file:rounded-md file:border file:bg-background file:px-2 file:py-1 file:text-xs file:font-medium"
            disabled={uploading || !ownerId}
          />
          <p className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
            <Upload className="h-3 w-3" />
            {uploading
              ? "Uploading…"
              : "Direct-to-S3 upload. Per-type size + MIME limits enforced server-side."}
          </p>
        </div>
      )}
      {errorMsg && <p className="text-xs text-destructive">{errorMsg}</p>}
      {error && (
        <p className="text-xs text-destructive">Could not load attachments.</p>
      )}
      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyMessage}</p>
      ) : (
        <ul className="divide-y rounded-md border bg-card">
          {items.map((a) => (
            <li
              key={a.id}
              className="flex items-start justify-between gap-2 p-2 text-xs"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1 font-medium text-foreground">
                  <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="truncate">{a.filename}</span>
                </div>
                <div className="mt-0.5 text-[10px] text-muted-foreground">
                  {humanSize(a.sizeBytes)} · {formatDate(a.uploadedAt)}
                  {a.uploadedBy ? ` · by ${a.uploadedBy.name}` : ""}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => handleDownload(a.id)}
                  title="Download"
                >
                  <Download className="h-3.5 w-3.5" />
                </Button>
                {canDelete && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(a.id)}
                    title="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
