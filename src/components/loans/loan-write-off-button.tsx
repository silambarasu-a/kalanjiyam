"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmPopover } from "@/components/ui/confirm-popover";
import { mutateBalances } from "@/lib/mutate-balances";
import { formatINR } from "@/lib/utils";

/**
 * Give up on the unrecovered principal of a loan you lent out.
 *
 * The only other exits are editing the outstanding to zero (which the
 * closed-loan lock eventually blocks) or deleting the loan (blocked once it has
 * history), so this is the clean one. No cash transaction is posted — nothing
 * actually moved — the receivable simply stops counting toward net worth.
 */
export function LoanWriteOffButton({
  loanId,
  outstanding,
}: {
  loanId: string;
  outstanding: number;
}) {
  const router = useRouter();
  return (
    <ConfirmPopover
      title="Write off this loan?"
      description={`${formatINR(outstanding)} of principal will be recorded as unrecoverable and the loan closed. No transaction is created — the money never came back, so no account balance changes. This cannot be undone.`}
      confirmLabel="Write off"
      busyLabel="Writing off…"
      onConfirm={async () => {
        const res = await fetch(`/api/loans/${loanId}/write-off`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            writtenOffAt: new Date().toISOString().slice(0, 10),
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(body.error ?? "Failed");
          throw new Error(body.error ?? "Failed");
        }
        toast.success("Written off");
        await mutateBalances();
        router.refresh();
      }}
      trigger={
        <Button variant="outline" size="sm">
          Write off
        </Button>
      }
    />
  );
}
