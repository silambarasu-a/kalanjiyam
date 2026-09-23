"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn, formatINR } from "@/lib/utils";
import { Check, ChevronsUpDown, Star, X } from "lucide-react";

export type ContactOption = { id: string; name: string; favorite?: boolean };

export type SplitDraft = {
  contactId: string;
  amount: number;
  sharePercent: number | null;
  isRecoverable: boolean;
  notes: string | null;
};

export type SplitMode = "equal" | "custom";
export type SplitUnit = "amount" | "percent";

// A fresh split is "tag only" until the user ticks "Recover this share":
// tagging a contact on an expense is far more common than raising a
// receivable against them, and an accidental receivable is the costlier
// mistake to clean up.
export function makeEmptySplit(): SplitDraft {
  return { contactId: "", amount: 0, sharePercent: null, isRecoverable: false, notes: null };
}

/**
 * Recompute amounts for splits when total or mode changes. In "equal" mode
 * every selected contact gets totalAmount/N (rupee-rounded; remainder lands
 * on the last row so the sum matches exactly). In "custom" mode rows are
 * left alone — the caller edits them per-row.
 */
export function recalcEqual(splits: SplitDraft[], totalAmount: number): SplitDraft[] {
  if (splits.length === 0 || totalAmount <= 0) return splits;
  const baseShare = Math.floor((totalAmount * 100) / splits.length) / 100;
  const last = +(totalAmount - baseShare * (splits.length - 1)).toFixed(2);
  return splits.map((s, i) => ({
    ...s,
    amount: i === splits.length - 1 ? last : baseShare,
    sharePercent: null,
  }));
}

type Props = {
  totalAmount: number;
  contacts: ContactOption[];
  splits: SplitDraft[];
  onChange: (next: SplitDraft[]) => void;
  mode: SplitMode;
  onModeChange: (mode: SplitMode) => void;
  unit: SplitUnit;
  onUnitChange: (unit: SplitUnit) => void;
  /**
   * Open the first row's contact picker as soon as the editor appears, so
   * "+ Split this expense with contacts?" lands the user straight in the
   * contact search. Only kicks in when that first row has no contact yet —
   * an editor mounted over saved splits (edit dialog) stays quiet.
   */
  autoFocus?: boolean;
};

export function TransactionSplitEditor({
  totalAmount,
  contacts,
  splits,
  onChange,
  mode,
  onModeChange,
  unit,
  onUnitChange,
  autoFocus = false,
}: Props) {
  // Index of the row whose picker should open itself on mount: row 0 when
  // the editor was just opened, then each row added via "+ Add contact".
  // A picker reads this once, at mount, so index reuse after removing a
  // row never re-opens an existing picker.
  const [autoOpenIndex, setAutoOpenIndex] = useState<number | null>(() =>
    autoFocus && splits.length > 0 && !splits[0].contactId ? 0 : null,
  );
  const sum = useMemo(
    () => splits.reduce((acc, s) => acc + (Number.isFinite(s.amount) ? s.amount : 0), 0),
    [splits],
  );
  const remainder = totalAmount - sum;
  const overTotal = sum > totalAmount + 0.005;
  const matchesTotal = Math.abs(remainder) < 0.005;

  const usedContactIds = new Set(splits.map((s) => s.contactId).filter(Boolean));
  const availableContacts = (currentId: string) =>
    contacts.filter((c) => c.id === currentId || !usedContactIds.has(c.id));

  function addRow() {
    const next = [...splits, makeEmptySplit()];
    setAutoOpenIndex(next.length - 1);
    onChange(mode === "equal" ? recalcEqual(next, totalAmount) : next);
  }
  function removeRow(i: number) {
    const next = splits.filter((_, idx) => idx !== i);
    onChange(mode === "equal" ? recalcEqual(next, totalAmount) : next);
  }
  function patchRow(i: number, patch: Partial<SplitDraft>) {
    const next = splits.map((s, idx) => (idx === i ? { ...s, ...patch } : s));
    onChange(next);
  }
  function handleContactChange(i: number, contactId: string) {
    patchRow(i, { contactId });
    if (mode === "equal") {
      const next = splits.map((s, idx) =>
        idx === i ? { ...s, contactId } : s,
      );
      onChange(recalcEqual(next, totalAmount));
    }
  }
  function handleAmountChange(i: number, raw: string) {
    if (unit === "percent") {
      const pct = parseFloat(raw);
      const safePct = Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0;
      const amt = +((totalAmount * safePct) / 100).toFixed(2);
      patchRow(i, { amount: amt, sharePercent: safePct });
    } else {
      const n = parseFloat(raw);
      patchRow(i, { amount: Number.isFinite(n) ? n : 0, sharePercent: null });
    }
  }
  function setMode(next: SplitMode) {
    onModeChange(next);
    if (next === "equal") {
      onChange(recalcEqual(splits, totalAmount));
      onUnitChange("amount");
    }
  }

  return (
    <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Split between contacts
        </span>
        <div className="flex items-center gap-2">
          {mode === "custom" && (
            <div className="flex gap-1">
              <Button
                type="button"
                size="xs"
                variant={unit === "amount" ? "default" : "outline"}
                onClick={() => onUnitChange("amount")}
              >
                ₹
              </Button>
              <Button
                type="button"
                size="xs"
                variant={unit === "percent" ? "default" : "outline"}
                onClick={() => onUnitChange("percent")}
              >
                %
              </Button>
            </div>
          )}
          <div className="flex gap-1">
            <Button
              type="button"
              size="xs"
              variant={mode === "equal" ? "default" : "outline"}
              onClick={() => setMode("equal")}
            >
              Equal
            </Button>
            <Button
              type="button"
              size="xs"
              variant={mode === "custom" ? "default" : "outline"}
              onClick={() => setMode("custom")}
            >
              Custom
            </Button>
          </div>
        </div>
      </div>

      {splits.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No splits yet — add a contact to share this expense with.
        </p>
      ) : (
        <div className="space-y-2">
          {splits.map((s, i) => {
            const opts = availableContacts(s.contactId);
            return (
              <div
                key={i}
                className="rounded-md border bg-card p-2 space-y-2"
              >
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <ContactPicker
                      value={s.contactId}
                      onChange={(v) => handleContactChange(i, v)}
                      options={opts}
                      autoOpen={autoOpenIndex === i}
                    />
                  </div>
                  {mode === "custom" ? (
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-muted-foreground">
                        {unit === "percent" ? "%" : "₹"}
                      </span>
                      <Input
                        type="number"
                        min={0}
                        step={unit === "percent" ? "0.01" : "1"}
                        value={
                          unit === "percent"
                            ? s.sharePercent != null
                              ? String(s.sharePercent)
                              : ""
                            : s.amount
                              ? String(s.amount)
                              : ""
                        }
                        onChange={(e) => handleAmountChange(i, e.target.value)}
                        placeholder="0"
                        className="w-24 h-8"
                      />
                      {unit === "percent" && s.amount > 0 && (
                        <span className="text-[10px] tabular-nums text-muted-foreground">
                          {formatINR(s.amount)}
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs tabular-nums text-muted-foreground px-2">
                      {formatINR(s.amount)}
                    </span>
                  )}
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    onClick={() => removeRow(i)}
                    aria-label="Remove split"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={s.isRecoverable}
                    onChange={(e) => patchRow(i, { isRecoverable: e.target.checked })}
                    className="h-3.5 w-3.5 accent-primary"
                  />
                  <span className="text-[11px] text-muted-foreground">
                    {s.isRecoverable
                      ? "Recover this share — adds to their Outstanding"
                      : "Tag only — no balance to recover"}
                  </span>
                </label>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          size="xs"
          variant="outline"
          onClick={addRow}
          disabled={contacts.length === 0 || usedContactIds.size >= contacts.length}
        >
          + Add contact
        </Button>
        {splits.length > 0 && totalAmount > 0 && (
          <div
            className={cn(
              "text-xs font-medium tabular-nums",
              overTotal
                ? "text-rose-600"
                : matchesTotal
                  ? "text-emerald-700"
                  : "text-muted-foreground",
            )}
          >
            Splits {formatINR(sum)} / {formatINR(totalAmount)}
            {!matchesTotal && !overTotal && (
              <span className="ml-1">· your share {formatINR(remainder)}</span>
            )}
            {overTotal && (
              <span className="ml-1">
                · {formatINR(sum - totalAmount)} over
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ContactPicker({
  value,
  onChange,
  options,
  autoOpen = false,
}: {
  value: string;
  onChange: (id: string) => void;
  options: ContactOption[];
  /**
   * Start open. Base UI moves focus to the popup's first tabbable element
   * (the search input) on open, so the user can type a name immediately.
   * Read once at mount — later changes don't re-open the picker.
   */
  autoOpen?: boolean;
}) {
  const [open, setOpen] = useState(autoOpen);
  const [search, setSearch] = useState("");
  const selected = options.find((c) => c.id === value);

  useEffect(() => {
    if (!open) {
      /* eslint-disable react-hooks/set-state-in-effect -- reset transient input on close */
      setSearch("");
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label="Pick a contact"
            className={cn(
              "w-full justify-between font-normal h-9",
              !selected && "text-muted-foreground",
            )}
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate">{selected?.name ?? "— pick a contact —"}</span>
              {selected?.favorite && (
                <Star
                  aria-label="Favorite"
                  className="size-3.5 shrink-0 fill-amber-400 text-amber-400"
                />
              )}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        }
      />
      <PopoverContent
        className="w-[min(20rem,calc(100vw-2rem))] p-0"
        align="start"
      >
        <Command>
          <CommandInput
            placeholder="Search contacts…"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>No contacts match.</CommandEmpty>
            <CommandGroup>
              {options.map((c) => (
                <CommandItem
                  key={c.id}
                  value={c.name}
                  onSelect={() => {
                    onChange(c.id);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === c.id ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {c.name}
                  {c.favorite && (
                    <Star
                      aria-label="Favorite"
                      className="size-3.5 fill-amber-400 text-amber-400"
                    />
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
