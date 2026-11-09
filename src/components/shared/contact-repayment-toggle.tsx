"use client";

import { Check, Gift, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Full-width segmented control shown when "Pay from" is a contact. Two
 * mutually-exclusive options:
 *   `true`  → contact paid for me and I'll repay (creates USER_OWES MemberCharge).
 *   `false` → contact paid as a gift / treat (no obligation, history only).
 *
 * Shared by every "Pay from" form that offers the CONTACT group — the
 * transaction dialog, the loan EMI dialog and the ad-hoc loan settlement —
 * so the choice reads the same everywhere and maps to the same
 * `memberChargeType` (RECOVERABLE / GIFT) on the server.
 */
export function ContactRepaymentToggle({
  contactName,
  value,
  onChange,
}: {
  contactName: string | null;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  const opts: {
    key: boolean;
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    sub: string;
  }[] = [
    {
      key: true,
      icon: Wallet,
      label: "I'll repay them",
      sub: contactName
        ? `Adds to "You owe ${contactName}"`
        : "Adds to 'You owe' on their page",
    },
    {
      key: false,
      icon: Gift,
      label: "Gift / treat",
      sub: "History only, no obligation",
    },
  ];

  return (
    <fieldset className="space-y-2 rounded-xl border bg-muted/20 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <legend className="text-xs font-medium">
          How will this be settled?
        </legend>
        <span className="text-[10px] text-muted-foreground">
          {contactName ? `Paid by ${contactName}` : "Paid by contact"}
        </span>
      </div>
      <div
        role="radiogroup"
        aria-label="How will this be settled?"
        className="grid grid-cols-1 gap-2 sm:grid-cols-2"
      >
        {opts.map((o) => {
          const active = value === o.key;
          const Icon = o.icon;
          return (
            <button
              key={String(o.key)}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(o.key)}
              className={cn(
                "group relative flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-all outline-none",
                "focus-visible:ring-2 focus-visible:ring-ring/40",
                active
                  ? "border-primary bg-background shadow-sm ring-1 ring-primary/20"
                  : "border-input bg-background/60 hover:border-input/80 hover:bg-background",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
                  active
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0 flex-1 space-y-0.5">
                <span
                  className={cn(
                    "block text-sm font-medium leading-tight",
                    active ? "text-foreground" : "text-foreground/80",
                  )}
                >
                  {o.label}
                </span>
                <span className="block text-[11px] leading-snug text-muted-foreground">
                  {o.sub}
                </span>
              </span>
              {active && (
                <Check className="absolute right-2.5 top-2.5 h-3.5 w-3.5 text-primary" />
              )}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/** `memberChargeType` value the APIs take for a contact-paid row. */
export function contactChargeType(repay: boolean): "RECOVERABLE" | "GIFT" {
  return repay ? "RECOVERABLE" : "GIFT";
}
