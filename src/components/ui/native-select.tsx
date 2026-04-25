"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type NativeSelectOption = {
  value: string;
  label: string;
  /** Optional secondary text shown right-aligned and muted (e.g. balance, kind tag). */
  hint?: string;
  disabled?: boolean;
};

export type NativeSelectGroup = {
  label: string;
  options: NativeSelectOption[];
};

type Items = NativeSelectOption[] | NativeSelectGroup[];

function isGrouped(items: Items): items is NativeSelectGroup[] {
  return items.length > 0 && "options" in (items[0] as object);
}

/**
 * NativeSelect — fixed-list dropdown that mirrors the BankPicker shell so
 * Kind / account pickers visually line up with the Lender field.
 *
 * Supports flat options or grouped options (replaces native <optgroup>).
 */
export function NativeSelect({
  value,
  onChange,
  options,
  placeholder = "— pick —",
  className,
  disabled,
  autoFocus,
}: {
  value: string;
  onChange: (next: string) => void;
  options: Items;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const [menuRect, setMenuRect] = useState<{ top: number; left: number; width: number } | null>(
    null,
  );
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Flat list of selectable options for keyboard nav + lookup.
  const flat = useMemo<NativeSelectOption[]>(
    () =>
      isGrouped(options)
        ? options.flatMap((g) => g.options)
        : (options as NativeSelectOption[]),
    [options]
  );

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Position the portaled menu under the trigger; recompute on scroll/resize
  // so it follows the trigger when an ancestor scrolls (e.g. table wrapper).
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const r = buttonRef.current?.getBoundingClientRect();
      if (r) setMenuRect({ top: r.bottom, left: r.left, width: r.width });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  const selected = flat.find((o) => o.value === value);
  const display = selected?.label ?? "";

  function commit(next: string) {
    onChange(next);
    setOpen(false);
    setHighlighted(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlighted((h) => Math.min(flat.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      setHighlighted((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter" || e.key === " ") {
      if (open && highlighted >= 0 && flat[highlighted] && !flat[highlighted].disabled) {
        e.preventDefault();
        commit(flat[highlighted].value);
      } else if (!open) {
        e.preventDefault();
        setOpen(true);
        setHighlighted(Math.max(0, flat.findIndex((o) => o.value === value)));
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setHighlighted(-1);
    }
  }

  function renderOption(o: NativeSelectOption, i: number) {
    return (
      <li key={o.value}>
        <button
          type="button"
          role="option"
          aria-selected={value === o.value}
          disabled={o.disabled}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => !o.disabled && commit(o.value)}
          onMouseEnter={() => !o.disabled && setHighlighted(i)}
          className={cn(
            "flex w-full items-center gap-2 px-3 py-1.5 text-sm text-left",
            o.disabled && "opacity-50 cursor-not-allowed",
            !o.disabled && (highlighted === i ? "bg-accent text-accent-foreground" : "hover:bg-accent/50")
          )}
        >
          <span className="flex-1 whitespace-nowrap">{o.label}</span>
          {o.hint && (
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
              {o.hint}
            </span>
          )}
          {value === o.value && <Check className="h-4 w-4 text-primary" />}
        </button>
      </li>
    );
  }

  return (
    <div ref={wrapRef} className={cn("relative", className)}>
      <div className="relative">
        <button
          ref={buttonRef}
          type="button"
          autoFocus={autoFocus}
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          onKeyDown={onKeyDown}
          className="flex h-9 w-full items-center rounded-lg border border-input bg-transparent pl-3 pr-9 py-1 text-sm text-left transition-colors outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className={cn("flex-1 truncate", !display && "text-muted-foreground")}>
            {display || placeholder}
          </span>
        </button>
        <span
          aria-hidden
          className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground"
        >
          <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
        </span>
      </div>

      {open && menuRect && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              role="listbox"
              style={{
                position: "fixed",
                top: menuRect.top + 4,
                left: menuRect.left,
                minWidth: menuRect.width,
                maxWidth: `min(28rem, calc(100vw - ${menuRect.left + 8}px))`,
              }}
              className="z-50 rounded-lg border bg-popover shadow-(--shadow-popover) max-h-72 overflow-y-auto w-max"
            >
              {flat.length === 0 ? (
                <div className="px-3 py-3 text-xs text-muted-foreground">No options.</div>
              ) : isGrouped(options) ? (
                <div className="py-1">
                  {options.map((g) => (
                    <div key={g.label}>
                      <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-widest text-muted-foreground">
                        {g.label}
                      </div>
                      <ul>
                        {g.options.map((o) => {
                          const flatIdx = flat.indexOf(o);
                          return renderOption(o, flatIdx);
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              ) : (
                <ul className="py-1">
                  {(options as NativeSelectOption[]).map((o, i) => renderOption(o, i))}
                </ul>
              )}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
