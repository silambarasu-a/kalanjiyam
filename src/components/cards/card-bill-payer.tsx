"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PayBillDialog } from "@/components/cards/pay-bill-dialog";

/**
 * Inline "Pay bill" button. Each instance owns its own dialog state so it
 * can drop into the due strip and into individual statement rows without
 * the card detail server component needing to thread state.
 */
export function PayBillButton({
  cardName,
  toAccountId,
  outstanding,
  dueDate,
  contextLabel,
  variant = "primary",
  label,
}: {
  cardName: string;
  toAccountId: string;
  outstanding: number;
  dueDate?: string | null;
  contextLabel?: string | null;
  variant?: "primary" | "outline" | "ghost";
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        size="sm"
        variant={
          variant === "outline"
            ? "outline"
            : variant === "ghost"
              ? "ghost"
              : "default"
        }
        className="gap-1.5"
      >
        <Wallet className="h-3.5 w-3.5" /> {label ?? "Pay bill"}
      </Button>
      <PayBillDialog
        open={open}
        onClose={() => setOpen(false)}
        cardName={cardName}
        toAccountId={toAccountId}
        outstanding={outstanding}
        dueDate={dueDate}
        contextLabel={contextLabel}
      />
    </>
  );
}

/**
 * Watches `?pay=1` on the card-detail page and pops the dialog once on
 * load — used so the Pay shortcut from dashboard / notifications can deep
 * link straight into the payment flow. Picks the headline outstanding
 * (payment-due strip) when present, falls back to the oldest unpaid
 * statement, otherwise no-op.
 */
export function PayBillAutoOpener({
  cardName,
  toAccountId,
  headline,
  fallbackStatement,
}: {
  cardName: string;
  toAccountId: string;
  headline: { outstanding: number; dueDate: string | null } | null;
  fallbackStatement: {
    outstanding: number;
    dueDate: string;
    periodLabel: string;
  } | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [active, setActive] = useState<{
    outstanding: number;
    dueDate: string | null;
    contextLabel: string | null;
  } | null>(null);
  const [consumed, setConsumed] = useState(false);

  useEffect(() => {
    if (consumed) return;
    if (searchParams.get("pay") !== "1") return;
    /* eslint-disable react-hooks/set-state-in-effect -- one-shot URL trigger,
       runs once per landing on ?pay=1 and immediately strips the param */
    setConsumed(true);
    if (headline && headline.outstanding > 0) {
      setActive({
        outstanding: headline.outstanding,
        dueDate: headline.dueDate,
        contextLabel: null,
      });
    } else if (fallbackStatement && fallbackStatement.outstanding > 0) {
      setActive({
        outstanding: fallbackStatement.outstanding,
        dueDate: fallbackStatement.dueDate,
        contextLabel: fallbackStatement.periodLabel,
      });
    }
    /* eslint-enable react-hooks/set-state-in-effect */
    const params = new URLSearchParams(searchParams.toString());
    params.delete("pay");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [
    searchParams,
    headline,
    fallbackStatement,
    consumed,
    pathname,
    router,
  ]);

  return (
    <PayBillDialog
      open={active !== null}
      onClose={() => setActive(null)}
      cardName={cardName}
      toAccountId={toAccountId}
      outstanding={active?.outstanding ?? 0}
      dueDate={active?.dueDate ?? null}
      contextLabel={active?.contextLabel ?? null}
    />
  );
}
