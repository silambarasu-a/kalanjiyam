"use client";

import { type ReactElement, type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";

/**
 * Inline confirmation popover. Wraps an arbitrary trigger element and
 * shows a small popover with title/description and Cancel + Confirm
 * buttons. Replaces native `confirm()` calls for delete-style actions.
 *
 * The trigger is passed as a ReactElement and forwarded via Base UI's
 * `render` prop, so the caller controls its variant/size/icon while the
 * popover handles open state, accessibility, and focus management.
 *
 * If `onConfirm` throws, the popover stays open so the user can retry.
 */
export function ConfirmPopover({
  trigger,
  title,
  description,
  confirmLabel = "Delete",
  busyLabel,
  busy = false,
  destructive = true,
  side = "top",
  align = "end",
  onConfirm,
}: {
  trigger: ReactElement;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  busyLabel?: string;
  busy?: boolean;
  destructive?: boolean;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  onConfirm: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);

  async function handleConfirm() {
    try {
      await onConfirm();
      setOpen(false);
    } catch {
      // caller threw — leave the popover open so the user can retry
    }
  }

  return (
    <Popover open={open} onOpenChange={(o) => !busy && setOpen(o)}>
      <PopoverTrigger render={trigger} />
      <PopoverContent className="w-72" side={side} align={align}>
        <PopoverHeader>
          <PopoverTitle>{title}</PopoverTitle>
          {description && <PopoverDescription>{description}</PopoverDescription>}
        </PopoverHeader>
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setOpen(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            size="sm"
            onClick={handleConfirm}
            disabled={busy}
          >
            {busy ? (busyLabel ?? "Working…") : confirmLabel}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
