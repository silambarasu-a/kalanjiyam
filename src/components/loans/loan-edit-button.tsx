"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  LoanForm,
  type EditingLoan,
  type LoanFormHandle,
} from "@/components/loans/loan-form";

export function LoanEditButton({ loan }: { loan: EditingLoan }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const formRef = useRef<LoanFormHandle>(null);
  const [busy, setBusy] = useState(false);

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        className="gap-1.5"
      >
        <Pencil className="h-3.5 w-3.5" />
        Edit
      </Button>
      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="w-[min(36rem,calc(100%-2rem))] max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit loan</DialogTitle>
          </DialogHeader>
          {open && (
            <LoanForm
              ref={formRef}
              source={loan.source}
              editingLoan={loan}
              onSaved={() => {
                setOpen(false);
                router.refresh();
              }}
              onSubmittingChange={setBusy}
            />
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => formRef.current?.submit()}
              disabled={busy}
            >
              {busy ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
