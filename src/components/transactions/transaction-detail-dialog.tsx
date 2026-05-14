"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Download, FileText, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatINR, formatDate } from "@/lib/utils";

/**
 * Read-only detail view for a single transaction. Opened by the View
 * (eye) icon on the transactions list. Renders every linked context
 * (category, account / card, beneficiary, vehicle, event, fuel,
 * hospitalization, transfer legs) plus inline previews of attached
 * receipts.
 *
 *   - Images render as `<img>` (lazy-loaded, click to enlarge).
 *   - PDFs render as an `<iframe>` embedded preview at a fixed height
 *     with a Download button. Avoids the new-tab roundtrip.
 *   - Each attachment row has its own Download button.
 *
 * The presigned URLs in the response are server-signed with a 5-min
 * TTL — so opening the dialog forces a fresh fetch (no stale URLs).
 */

type DetailResponse = {
  transaction: {
    id: string;
    type: "INCOME" | "EXPENSE" | "INVESTMENT" | "HAND_LOAN" | "TRANSFER";
    kind: string | null;
    amount: number;
    description: string;
    date: string;
    createdAt: string;
    updatedAt: string;
    editedAt: string | null;
    editNote: string | null;
    category: {
      id: string;
      name: string;
      parent: { id: string; name: string } | null;
    } | null;
    account: { id: string; name: string; kind: string } | null;
    card: { id: string; name: string } | null;
    beneficiary: { id: string; name: string } | null;
    memberChargeType: "NONE" | "RECOVERABLE" | "GIFT";
    memberCharge: {
      id: string;
      status: string;
      amount: number;
      settledAmount: number;
    } | null;
    vehicle: { id: string; name: string; registrationNo: string | null } | null;
    event: { id: string; name: string; kind: string } | null;
    hospitalization: {
      id: string;
      hospitalName: string;
      patientContact: { id: string; name: string };
    } | null;
    hospitalizationStage: "PRE" | "DURING" | "POST" | null;
    transferId: string | null;
    transfer: {
      fromAccount: { id: string; name: string; kind: string } | null;
      toAccount: { id: string; name: string; kind: string } | null;
      fromContact: { id: string; name: string } | null;
      toContact: { id: string; name: string } | null;
    } | null;
    fuelQuantity: number | null;
    fuelUnit: string | null;
    fuelOdometer: number | null;
    author: { id: string; name: string } | null;
  };
  attachments: {
    id: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    uploadedAt: string;
    uploadedBy: { id: string; name: string } | null;
    url: string | null;
  }[];
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function TransactionDetailDialog({
  transactionId,
  open,
  onOpenChange,
  onEdit,
}: {
  transactionId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called when the user clicks the Edit button. The parent owns the
   * edit-dialog state so the two dialogs can hand off cleanly. */
  onEdit?: () => void;
}) {
  const { data, isLoading } = useSWR<DetailResponse>(
    open && transactionId ? `/api/transactions/${transactionId}` : null,
    fetcher,
  );

  const tx = data?.transaction;
  const attachments = data?.attachments ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(48rem,calc(100%-2rem))] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Transaction details</DialogTitle>
        </DialogHeader>

        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isLoading && !tx && (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Transaction not found.
          </p>
        )}

        {tx && (
          <div className="space-y-5">
            {/* Hero: amount + description */}
            <div className="rounded-xl border bg-card p-4">
              <div className="flex items-baseline justify-between gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {tx.type}
                    {tx.kind ? ` · ${tx.kind.replace(/_/g, " ")}` : ""}
                  </div>
                  <div
                    className={`mt-1 text-3xl font-semibold tabular-nums ${
                      tx.type === "INCOME"
                        ? "text-emerald-700 dark:text-emerald-400"
                        : tx.type === "EXPENSE"
                          ? ""
                          : ""
                    }`}
                  >
                    {tx.type === "INCOME" ? "+" : ""}
                    {formatINR(tx.amount)}
                  </div>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  {formatDate(tx.date)}
                </div>
              </div>
              <p className="mt-3 text-sm">{tx.description}</p>
            </div>

            {/* Metadata grid */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {tx.category && (
                <Field
                  label="Category"
                  value={
                    tx.category.parent
                      ? `${tx.category.parent.name} › ${tx.category.name}`
                      : tx.category.name
                  }
                />
              )}
              {tx.account && (
                <Field
                  label={
                    tx.type === "INCOME" ? "To account" : "Paid from"
                  }
                  value={`${tx.account.name} (${tx.account.kind.toLowerCase()})`}
                />
              )}
              {tx.card && <Field label="Card" value={tx.card.name} />}
              {tx.beneficiary && (
                <Field
                  label={
                    tx.memberChargeType === "RECOVERABLE"
                      ? "For (recoverable)"
                      : tx.memberChargeType === "GIFT"
                        ? "For (gift)"
                        : "Beneficiary"
                  }
                  value={tx.beneficiary.name}
                />
              )}
              {tx.vehicle && (
                <Field
                  label="Vehicle"
                  value={`${tx.vehicle.name}${tx.vehicle.registrationNo ? ` · ${tx.vehicle.registrationNo}` : ""}`}
                />
              )}
              {tx.event && (
                <Field
                  label="Event / Trip"
                  value={`${tx.event.name} (${tx.event.kind.toLowerCase()})`}
                />
              )}
              {tx.hospitalization && (
                <Field
                  label={`Medical${tx.hospitalizationStage ? ` · ${tx.hospitalizationStage.toLowerCase()}` : ""}`}
                  value={`${tx.hospitalization.patientContact.name} @ ${tx.hospitalization.hospitalName}`}
                />
              )}
              {tx.fuelQuantity != null && (
                <Field
                  label="Fuel"
                  value={`${tx.fuelQuantity.toFixed(2)} ${tx.fuelUnit ?? "L"}${
                    tx.fuelOdometer != null
                      ? ` · ${tx.fuelOdometer.toLocaleString()} km`
                      : ""
                  }`}
                />
              )}
              {tx.author && <Field label="Logged by" value={tx.author.name} />}
            </div>

            {/* Member-charge settle state */}
            {tx.memberCharge && tx.memberCharge.status !== "WRITTEN_OFF" && (
              <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                <div className="font-medium">Recoverable from contact</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {formatINR(tx.memberCharge.settledAmount)} settled of{" "}
                  {formatINR(tx.memberCharge.amount)} ·{" "}
                  <span className="uppercase">
                    {tx.memberCharge.status.replace(/_/g, " ")}
                  </span>
                </div>
              </div>
            )}

            {/* Edit note */}
            {tx.editNote && (
              <div className="rounded-lg border bg-amber-50 dark:bg-amber-950/30 p-3 text-xs">
                <span className="font-medium">Edit note:</span> {tx.editNote}
              </div>
            )}

            {/* Receipts / supporting docs */}
            <section>
              <h3 className="text-sm font-semibold mb-2">
                Receipts &amp; supporting documents{" "}
                <span className="font-normal text-muted-foreground">
                  ({attachments.length})
                </span>
              </h3>
              {attachments.length === 0 ? (
                <p className="rounded-lg border bg-card p-4 text-xs text-muted-foreground">
                  No documents attached. Use the Edit button to upload a
                  receipt or supporting file.
                </p>
              ) : (
                <div className="space-y-3">
                  {attachments.map((a) => (
                    <AttachmentPreview key={a.id} attachment={a} />
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {onEdit && tx && (
            <Button onClick={onEdit} variant="outline">
              Edit
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 text-sm font-medium truncate">{value}</div>
    </div>
  );
}

function AttachmentPreview({
  attachment,
}: {
  attachment: DetailResponse["attachments"][number];
}) {
  const [expanded, setExpanded] = useState(false);
  const isImage = attachment.mimeType.startsWith("image/");
  const isPdf = attachment.mimeType === "application/pdf";

  function downloadFile() {
    if (!attachment.url) {
      toast.error("File preview not available");
      return;
    }
    // Force a download by appending the filename hint. Browsers honour
    // the Content-Disposition from S3 if set, otherwise the link's
    // `download` attribute takes effect for same-origin URLs only —
    // for cross-origin S3, the fetch+blob trick gives us a true save.
    const a = document.createElement("a");
    a.href = attachment.url;
    a.download = attachment.filename;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="flex items-center gap-3 px-3 py-2 border-b bg-muted/20">
        <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">
            {attachment.filename}
          </div>
          <div className="text-[10px] text-muted-foreground">
            {humanSize(attachment.sizeBytes)} ·{" "}
            {formatDate(attachment.uploadedAt)}
            {attachment.uploadedBy ? ` · by ${attachment.uploadedBy.name}` : ""}
          </div>
        </div>
        {attachment.url && (
          <a
            href={attachment.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center rounded-md border h-8 w-8 hover:bg-muted/40 transition shrink-0"
            title="Open in new tab"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
        <Button
          variant="outline"
          size="sm"
          className="gap-1 shrink-0"
          onClick={downloadFile}
          disabled={!attachment.url}
          title="Download"
        >
          <Download className="h-3.5 w-3.5" /> Download
        </Button>
      </div>
      {attachment.url ? (
        <div className="bg-muted/10">
          {isImage ? (
            // eslint-disable-next-line @next/next/no-img-element -- presigned URL, can't use Next/Image
            <img
              src={attachment.url}
              alt={attachment.filename}
              className={`mx-auto block ${expanded ? "max-h-[60vh]" : "max-h-[260px]"} w-auto cursor-zoom-${expanded ? "out" : "in"} transition`}
              loading="lazy"
              onClick={() => setExpanded((e) => !e)}
            />
          ) : isPdf ? (
            <iframe
              src={attachment.url}
              title={attachment.filename}
              className="block w-full h-[400px] border-0"
            />
          ) : (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              Preview not available for this file type. Use Download to view.
            </div>
          )}
        </div>
      ) : (
        <div className="px-3 py-4 text-xs text-muted-foreground">
          Preview URL unavailable (file storage not configured).
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
