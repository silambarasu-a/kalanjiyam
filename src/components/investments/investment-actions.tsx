"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmPopover } from "@/components/ui/confirm-popover";
import { useTransactionDialog } from "@/contexts/transaction-dialog";
import { mutateBalances } from "@/lib/mutate-balances";

type InvestmentLite = {
  id: string;
  name: string;
};

/**
 * Inline edit + delete affordances for an investment, used on both the
 * list page (per card) and the detail page (header). Edit opens the
 * standard transaction dialog in edit mode — the form pre-fills from
 * the existing holding + its BUY splits, and submit PATCHes. Delete
 * confirms via popover; if the API blocks because transactions exist,
 * the message tells the user to delete those first or archive instead.
 */
export function InvestmentActions({
  investment,
  /** Stop the surrounding card-link from navigating when clicking icons. */
  stopPropagation = false,
  /** Where to redirect after a successful delete. Detail page passes
   * "/investments"; list page leaves it null and just refreshes. */
  redirectAfterDelete,
  className,
}: {
  investment: InvestmentLite;
  stopPropagation?: boolean;
  redirectAfterDelete?: string;
  className?: string;
}) {
  const router = useRouter();
  const { openDialog } = useTransactionDialog();
  const [deleting, setDeleting] = useState(false);

  function guard(e: React.MouseEvent | React.SyntheticEvent) {
    if (stopPropagation) {
      e.stopPropagation();
      e.preventDefault();
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/investments/${investment.id}`, {
        method: "DELETE",
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(body.error ?? "Failed to delete");
        return;
      }
      toast.success("Investment deleted");
      await mutateBalances();
      if (redirectAfterDelete) {
        router.push(redirectAfterDelete);
      } else {
        router.refresh();
      }
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div
      className={className}
      onClick={guard}
      onMouseDown={guard}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") guard(e);
      }}
    >
      <Button
        variant="ghost"
        size="icon"
        aria-label="Edit investment"
        onClick={(e) => {
          guard(e);
          openDialog("INVESTMENT", { editingInvestmentId: investment.id });
        }}
      >
        <Pencil className="h-4 w-4" />
      </Button>
      <ConfirmPopover
        title={`Delete ${investment.name}?`}
        description="This removes the holding and all of its linked transactions. Card and account balances will be restored. There's no undo."
        confirmLabel="Delete"
        busyLabel="Deleting…"
        busy={deleting}
        onConfirm={handleDelete}
        trigger={
          <Button
            variant="ghost"
            size="icon"
            aria-label="Delete investment"
            disabled={deleting}
            onClick={guard}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        }
      />
    </div>
  );
}
