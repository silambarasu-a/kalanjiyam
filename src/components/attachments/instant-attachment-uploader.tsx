"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { FileText, Loader2, Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ATTACHMENT_POLICY,
  type AttachmentOwnerKind,
} from "@/lib/attachments";

/**
 * Pick a file → it uploads immediately. Click X → it deletes from S3
 * immediately. Works before the parent row exists by minting a UUID
 * client-side via {@link useInstantAttachmentOwnerId}; pass that same
 * UUID as the row id when the parent finally gets POSTed.
 *
 * For "edit existing record" mode, pass the real ownerId and
 * draft=false. Removes within 60s use hard-delete; older removes fall
 * back to the existing soft-archive route (audit trail preserved).
 */

export type InstantAttachmentRow = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  status: "uploading" | "ready" | "error";
  progress?: number;
  errorMessage?: string;
};

export type InstantAttachmentUploaderHandle = {
  /** Hard-delete every uploaded attachment. Call from parent on cancel. */
  discardAll: () => Promise<void>;
};

type Props = {
  ownerKind: AttachmentOwnerKind;
  ownerId: string;
  /** True when ownerId refers to a not-yet-persisted parent row. */
  draft?: boolean;
  maxFiles?: number;
  disabled?: boolean;
  /** Pre-existing attachments (edit mode). */
  initial?: InstantAttachmentRow[];
  onChange?: (rows: InstantAttachmentRow[]) => void;
  /** Tighter file-picker UX; server enforces real MIME policy. */
  accept?: string;
  className?: string;
  /** Tiny helper text under the picker. */
  hint?: string;
};

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const InstantAttachmentUploader = forwardRef<
  InstantAttachmentUploaderHandle,
  Props
>(function InstantAttachmentUploader(
  {
    ownerKind,
    ownerId,
    draft = false,
    maxFiles = 5,
    disabled = false,
    initial,
    onChange,
    accept,
    className,
    hint,
  },
  ref,
) {
  const policy = ATTACHMENT_POLICY[ownerKind];
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [rows, setRows] = useState<InstantAttachmentRow[]>(initial ?? []);
  const [error, setError] = useState<string | null>(null);

  // Keep parent in sync via onChange. Use a ref to avoid re-firing on
  // every render — only fire when rows actually change.
  const lastNotified = useRef<InstantAttachmentRow[] | null>(null);
  useEffect(() => {
    if (lastNotified.current === rows) return;
    lastNotified.current = rows;
    onChange?.(rows);
  }, [rows, onChange]);

  // Refresh-protection: when we're in draft mode and have at least one
  // S3-resident file the parent hasn't submitted yet, warn before unload.
  // The orphan-GC cron eventually cleans abandoned uploads (24h), but
  // this avoids surprise data loss for the in-progress user. Manual
  // navigation inside the SPA isn't affected — only refresh / close.
  useEffect(() => {
    if (!draft) return;
    const hasPending = rows.some((r) => r.status === "ready" || r.status === "uploading");
    if (!hasPending) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      // Modern browsers ignore the message; the prompt is generic.
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [draft, rows]);

  const updateRow = useCallback(
    (id: string, patch: Partial<InstantAttachmentRow>) => {
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    },
    [],
  );

  const uploadFile = useCallback(
    async (file: File) => {
      const tempId = `tmp_${Math.random().toString(36).slice(2)}`;
      const row: InstantAttachmentRow = {
        id: tempId,
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        uploadedAt: new Date().toISOString(),
        status: "uploading",
        progress: 0,
      };
      setRows((prev) => [...prev, row]);

      try {
        const upRes = await fetch("/api/attachments/upload-url", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ownerKind,
            ownerId,
            filename: file.name,
            contentType: row.mimeType,
            size: file.size,
            draft,
          }),
        });
        const upBody = await upRes.json().catch(() => ({}));
        if (!upRes.ok) {
          updateRow(tempId, {
            status: "error",
            errorMessage: upBody.error ?? "Upload prepare failed",
          });
          return;
        }

        const putRes = await fetch(upBody.url, {
          method: "PUT",
          headers: { "content-type": row.mimeType },
          body: file,
        });
        if (!putRes.ok) {
          updateRow(tempId, {
            status: "error",
            errorMessage: `S3 PUT failed (${putRes.status})`,
          });
          return;
        }

        const finRes = await fetch("/api/attachments", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ownerKind,
            ownerId,
            s3Key: upBody.key,
            filename: file.name,
            mimeType: row.mimeType,
            sizeBytes: file.size,
            draft,
          }),
        });
        const finBody = await finRes.json().catch(() => ({}));
        if (!finRes.ok || !finBody.id) {
          updateRow(tempId, {
            status: "error",
            errorMessage: finBody.error ?? "Finalize failed",
          });
          return;
        }
        // Swap the temp row id for the real Attachment.id.
        setRows((prev) =>
          prev.map((r) =>
            r.id === tempId ? { ...r, id: finBody.id, status: "ready" } : r,
          ),
        );
      } catch (e) {
        updateRow(tempId, {
          status: "error",
          errorMessage: e instanceof Error ? e.message : "Network error",
        });
      }
    },
    [draft, ownerId, ownerKind, updateRow],
  );

  const onPick = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      setError(null);
      const remaining = Math.max(0, maxFiles - rows.length);
      const picked = Array.from(files).slice(0, remaining);
      if (picked.length < files.length) {
        setError(`Up to ${maxFiles} files allowed`);
      }
      const valid: File[] = [];
      for (const f of picked) {
        if (f.size > policy.maxMB * 1_000_000) {
          setError(`${f.name} is too large (limit ${policy.maxMB} MB)`);
          continue;
        }
        valid.push(f);
      }
      // Parallel uploads — each row reports its own state independently.
      await Promise.all(valid.map(uploadFile));
      if (inputRef.current) inputRef.current.value = "";
    },
    [maxFiles, policy.maxMB, rows.length, uploadFile],
  );

  const removeOne = useCallback(
    async (row: InstantAttachmentRow) => {
      if (row.status === "uploading") return;
      // Optimistic UI — drop the row first, undo on hard failure.
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      if (row.status === "error") return;
      const hardRes = await fetch(`/api/attachments/${row.id}/hard`, {
        method: "DELETE",
      });
      if (hardRes.ok) return;
      if (hardRes.status === 423) {
        // Grace window expired — fall back to soft-archive so the user
        // doesn't end up with a stale row that pretends to be attached.
        const softRes = await fetch(`/api/attachments/${row.id}`, {
          method: "DELETE",
        });
        if (softRes.ok) return;
        const sb = await softRes.json().catch(() => ({}));
        setError(sb.error ?? "Delete failed");
        setRows((prev) => [...prev, row]);
        return;
      }
      const hb = await hardRes.json().catch(() => ({}));
      setError(hb.error ?? "Delete failed");
      setRows((prev) => [...prev, row]);
    },
    [],
  );

  const discardAll = useCallback(async () => {
    const ready = rows.filter((r) => r.status === "ready" || r.status === "uploading");
    setRows([]);
    await Promise.all(
      ready.map((r) =>
        fetch(`/api/attachments/${r.id}/hard`, { method: "DELETE" }).catch(
          () => undefined,
        ),
      ),
    );
  }, [rows]);

  useImperativeHandle(ref, () => ({ discardAll }), [discardAll]);

  const acceptAttr = useMemo(() => {
    if (accept) return accept;
    // Translate the policy MIME list into the file-picker `accept` form.
    return policy.mime
      .map((m) => (m.endsWith("/*") ? m : m))
      .join(",");
  }, [accept, policy.mime]);

  return (
    <div className={className}>
      <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          <Paperclip className="h-3.5 w-3.5" />
          Attachments
          <span className="font-normal text-muted-foreground">
            ({rows.length}/{maxFiles})
          </span>
        </div>
        {rows.length > 0 && (
          <ul className="space-y-1">
            {rows.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-2 rounded-md border bg-background px-2 py-1.5 text-xs"
              >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  {r.status === "uploading" ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                  ) : (
                    <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-foreground">
                      {r.filename}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {humanSize(r.sizeBytes)}
                      {r.status === "uploading"
                        ? " · uploading…"
                        : r.status === "error"
                          ? ` · ${r.errorMessage ?? "error"}`
                          : ""}
                    </div>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0"
                  onClick={() => removeOne(r)}
                  disabled={disabled || r.status === "uploading"}
                  title="Remove"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <input
          ref={inputRef}
          type="file"
          multiple={maxFiles > 1}
          accept={acceptAttr}
          disabled={disabled || rows.length >= maxFiles}
          onChange={(e) => onPick(e.target.files)}
          className="block w-full text-xs file:mr-2 file:rounded-md file:border file:bg-background file:px-2 file:py-1 file:text-xs file:font-medium disabled:opacity-50"
        />
        <p className="text-[10px] text-muted-foreground">
          {hint ?? "Files upload instantly to S3. Remove to delete."}{" "}
          Limit {policy.maxMB} MB per file.
        </p>
        {error && <p className="text-[11px] text-destructive">{error}</p>}
      </div>
    </div>
  );
});

/**
 * Mint a UUID once per form session. Pass the returned id as both:
 *   - `ownerId` to InstantAttachmentUploader (draft=true), AND
 *   - the row `id` when you POST the parent record.
 *
 * Stable across re-renders. Resets only when the consumer remounts.
 */
export function useInstantAttachmentOwnerId(): string {
  const [ownerId] = useState(() =>
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  return ownerId;
}
