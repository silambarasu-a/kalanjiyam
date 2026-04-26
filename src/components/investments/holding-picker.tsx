"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export type Holding = {
  id: string;
  kind: string;
  name: string;
  symbol: string | null;
  exchange?: string | null;
  quantity: number | null;
  amount: number;
};

/**
 * Searchable holding picker — opens a portaled popover with a search box
 * and the filtered list of active holdings. Filters by name, symbol, and
 * kind. Picking commits the holding id; the trigger displays a compact
 * summary (name · symbol · qty/amount).
 */
export function HoldingPicker({
  value,
  onChange,
  holdings,
  placeholder = "Search holdings…",
  autoFocus,
  onAddNew,
}: {
  value: string;
  onChange: (id: string) => void;
  holdings: Holding[];
  placeholder?: string;
  autoFocus?: boolean;
  /** When set, a "+ Add new holding" footer is rendered in the popover. */
  onAddNew?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const [menuRect, setMenuRect] = useState<{ top: number; left: number; width: number } | null>(
    null,
  );
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const selected = holdings.find((h) => h.id === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return holdings;
    return holdings
      .filter((h) => {
        const blob = `${h.name} ${h.symbol ?? ""} ${h.kind}`.toLowerCase();
        return blob.includes(q);
      })
      .sort((a, b) => {
        const aStarts = a.name.toLowerCase().startsWith(q) ? 0 : 1;
        const bStarts = b.name.toLowerCase().startsWith(q) ? 0 : 1;
        if (aStarts !== bStarts) return aStarts - bStarts;
        return a.name.localeCompare(b.name);
      });
  }, [holdings, query]);

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

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const r = triggerRef.current?.getBoundingClientRect();
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

  useEffect(() => {
    if (open) {
      // Focus the search box on open and reset highlight.
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  function commit(id: string) {
    onChange(id);
    setOpen(false);
    setQuery("");
    setHighlighted(0);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(filtered.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter") {
      const pick = filtered[highlighted];
      if (pick) {
        e.preventDefault();
        commit(pick.id);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        autoFocus={autoFocus}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-full items-center rounded-lg border border-input bg-transparent pl-3 pr-9 py-1 text-sm text-left transition-colors outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/30"
      >
        <span className={cn("flex-1 truncate", !selected && "text-muted-foreground")}>
          {selected ? <HoldingDisplay h={selected} /> : "— pick holding —"}
        </span>
        <ChevronDown
          className={cn(
            "absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

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
                maxWidth: `min(34rem, calc(100vw - ${menuRect.left + 8}px))`,
              }}
              className="z-50 rounded-lg border bg-popover shadow-(--shadow-popover) overflow-hidden"
            >
              <div className="relative border-b">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60 pointer-events-none" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setHighlighted(0);
                  }}
                  onKeyDown={onKeyDown}
                  placeholder={placeholder}
                  className="h-9 w-full bg-transparent pl-8 pr-3 text-sm outline-none"
                />
              </div>
              <div className="max-h-72 overflow-y-auto py-1">
                {filtered.length === 0 ? (
                  <p className="px-3 py-4 text-xs text-muted-foreground">
                    {holdings.length === 0
                      ? "No active holdings yet. Create one in Investments first."
                      : "No matches."}
                  </p>
                ) : (
                  <ul>
                    {filtered.map((h, i) => (
                      <li key={h.id}>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => commit(h.id)}
                          onMouseEnter={() => setHighlighted(i)}
                          className={cn(
                            "flex w-full items-start gap-2 px-3 py-2 text-sm text-left",
                            highlighted === i ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
                          )}
                        >
                          <KindBadge kind={h.kind} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium truncate">{h.name}</span>
                              {h.symbol && (
                                <span className="text-[10px] font-mono uppercase text-muted-foreground">
                                  {h.symbol}
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-muted-foreground tabular-nums">
                              {h.quantity != null
                                ? `${h.quantity} qty · ₹${Number(h.amount).toLocaleString("en-IN")}`
                                : `₹${Number(h.amount).toLocaleString("en-IN")}`}
                              {h.exchange ? ` · ${h.exchange}` : ""}
                            </div>
                          </div>
                          {value === h.id && <Check className="h-4 w-4 text-primary mt-0.5" />}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {onAddNew && (
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setOpen(false);
                    setQuery("");
                    onAddNew();
                  }}
                  className="flex w-full items-center gap-2 border-t bg-muted/30 px-3 py-2 text-sm text-left hover:bg-accent/50"
                >
                  <Plus className="h-4 w-4 text-primary" />
                  <span className="font-medium text-primary">Add new holding</span>
                </button>
              )}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function HoldingDisplay({ h }: { h: Holding }) {
  return (
    <span className="inline-flex items-center gap-2">
      <KindBadge kind={h.kind} />
      <span className="font-medium truncate">{h.name}</span>
      {h.symbol && (
        <span className="text-[10px] font-mono uppercase text-muted-foreground">
          {h.symbol}
        </span>
      )}
    </span>
  );
}

function KindBadge({ kind }: { kind: string }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      {kind}
    </span>
  );
}
