"use client";

import { useRef } from "react";
import type { AttachmentOwnerKind } from "@/lib/attachments";

/**
 * Stages files in React state before the parent row exists. After the
 * row is created (transaction / event / etc.), call
 * `uploadReceiptsToAttachment` with the new owner id to run the
 * three-step direct-to-S3 upload for each file.
 *
 * Re-used from the transaction-dialog so investment / transfer / loan-EMI
 * forms get the same receipt-staging affordance.
 */

/** Per-kind size cap (MB) — duplicated from ATTACHMENT_POLICY for inline
 * client-side validation. Keep in sync with src/lib/attachments.ts. */
export const RECEIPT_KIND_MAX_MB: Record<
  "VEHICLE_DOCUMENT" | "EVENT_DOCUMENT" | "TRANSACTION_RECEIPT",
  number
> = {
  VEHICLE_DOCUMENT: 20,
  EVENT_DOCUMENT: 25,
  TRANSACTION_RECEIPT: 50,
};

export async function uploadReceiptToAttachment(args: {
  file: File;
  ownerKind: "VEHICLE_DOCUMENT" | "EVENT_DOCUMENT" | "TRANSACTION_RECEIPT";
  ownerId: string;
}): Promise<{ error?: string }> {
  const { file, ownerKind, ownerId } = args;
  try {
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
      return { error: upBody.error ?? "Could not start upload" };
    }
    const putRes = await fetch(upBody.url, {
      method: "PUT",
      headers: { "content-type": file.type || "application/octet-stream" },
      body: file,
    });
    if (!putRes.ok) {
      return { error: `Upload failed (${putRes.status})` };
    }
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
    if (!finRes.ok) {
      const fbody = await finRes.json().catch(() => ({}));
      return { error: fbody.error ?? "Could not finalize upload" };
    }
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Network error" };
  }
}

/**
 * Sequentially uploads each staged file. Returns counts so the caller
 * can surface a single toast covering full / partial / total failure.
 */
export async function uploadReceiptsToAttachment(args: {
  files: File[];
  ownerKind: "VEHICLE_DOCUMENT" | "EVENT_DOCUMENT" | "TRANSACTION_RECEIPT";
  ownerId: string;
}): Promise<{ uploaded: number; errors: string[] }> {
  const { files, ownerKind, ownerId } = args;
  let uploaded = 0;
  const errors: string[] = [];
  for (const file of files) {
    const r = await uploadReceiptToAttachment({ file, ownerKind, ownerId });
    if (r.error) errors.push(`${file.name}: ${r.error}`);
    else uploaded++;
  }
  return { uploaded, errors };
}

export function ReceiptStager({
  value,
  onChange,
  ownerKind,
  destinationHint,
  onError,
}: {
  value: File[];
  onChange: (files: File[]) => void;
  /** Used to pick the right size cap for inline validation. */
  ownerKind: keyof typeof RECEIPT_KIND_MAX_MB;
  /** Friendly description of where the files will land. */
  destinationHint?: string;
  /** Surface validation errors back to the parent form. */
  onError?: (msg: string) => void;
}) {
  const maxMB = RECEIPT_KIND_MAX_MB[ownerKind];
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <div className="rounded-md border bg-muted/30 p-3 space-y-2">
      <div className="text-xs font-medium">
        Receipts / supporting files{" "}
        <span className="font-normal text-muted-foreground">(optional)</span>
      </div>
      {value.length > 0 && (
        <ul className="space-y-1">
          {value.map((f, idx) => (
            <li
              key={`${f.name}-${f.size}-${idx}`}
              className="flex items-center justify-between gap-2 rounded border bg-background px-2 py-1.5 text-xs"
            >
              <span className="truncate">
                {f.name} ({Math.round(f.size / 1024)} KB)
              </span>
              <button
                type="button"
                onClick={() => onChange(value.filter((_, i) => i !== idx))}
                className="underline hover:text-foreground shrink-0"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*,application/pdf"
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []);
          const valid: File[] = [];
          for (const f of picked) {
            if (f.size > maxMB * 1_000_000) {
              onError?.(`${f.name} is too large (limit ${maxMB} MB)`);
              continue;
            }
            valid.push(f);
          }
          if (valid.length > 0) onChange([...value, ...valid]);
          if (inputRef.current) inputRef.current.value = "";
        }}
        className="block w-full text-xs file:mr-2 file:rounded-md file:border file:bg-background file:px-2 file:py-1 file:text-xs file:font-medium"
      />
      <p className="text-[10px] text-muted-foreground">
        {destinationHint ?? "Attaches to the saved row."} Max {maxMB} MB per file.
      </p>
    </div>
  );
}

/** Type alias re-export for callers. */
export type _ReceiptOwnerKind = AttachmentOwnerKind;
